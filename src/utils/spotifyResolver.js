const https = require('https');
const http = require('http');

let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Perform HTTPS/HTTP request with IPv4 forced (avoids Windows Node v18+ IPv6 timeouts)
 */
function requestUrl(targetUrl, options = {}, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        try {
            const urlObj = new URL(targetUrl);
            const client = urlObj.protocol === 'http:' ? http : https;

            const req = client.request(urlObj, {
                method: options.method || 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    ...options.headers,
                },
                family: 4,
                timeout: timeoutMs,
            }, res => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data }));
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error(`Request timeout after ${timeoutMs}ms for ${targetUrl}`));
            });

            req.on('error', reject);

            if (options.body) {
                req.write(options.body);
            }
            req.end();
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Expand short links like spotify.link or spoti.fi by following HTTP 301/302 redirects
 */
async function expandSpotifyUrl(url, maxRedirects = 3) {
    if (!url || typeof url !== 'string') return url;
    let currentUrl = url.trim();

    for (let i = 0; i < maxRedirects; i++) {
        if (!/^(https?:\/\/)?(www\.)?(spotify\.link|spoti\.fi)\//i.test(currentUrl)) {
            break;
        }
        try {
            const res = await requestUrl(currentUrl, { method: 'HEAD' }, 5000);
            if (res.headers && res.headers.location) {
                currentUrl = res.headers.location;
            } else {
                break;
            }
        } catch {
            break;
        }
    }

    return currentUrl;
}

/**
 * Parse a Spotify URL or URI into type and ID
 */
function parseSpotifyUrl(url) {
    if (!url || typeof url !== 'string') return null;
    const cleanUrl = url.trim();

    // URI format: spotify:track:id, spotify:playlist:id, spotify:user:xxx:playlist:id
    const userPlaylistMatch = cleanUrl.match(/^spotify:user:[^:]+:playlist:([a-zA-Z0-9]+)/i);
    if (userPlaylistMatch) {
        return { type: 'playlist', id: userPlaylistMatch[1] };
    }

    const uriMatch = cleanUrl.match(/^spotify:(track|playlist|album|artist):([a-zA-Z0-9]+)/i);
    if (uriMatch) {
        return { type: uriMatch[1].toLowerCase(), id: uriMatch[2] };
    }

    // URL format: open.spotify.com/(optional prefix/)(track|playlist|album|artist)/id
    const urlMatch = cleanUrl.match(/open\.spotify\.com\/(?:[a-zA-Z0-9-_]+\/)?(track|playlist|album|artist)\/([a-zA-Z0-9]+)/i);
    if (urlMatch) {
        return { type: urlMatch[1].toLowerCase(), id: urlMatch[2] };
    }

    return null;
}

/**
 * Get Spotify API access token via client credentials if configured in environment
 */
async function getSpotifyApiToken() {
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    if (cachedToken && Date.now() < tokenExpiresAt) {
        return cachedToken;
    }

    try {
        const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const postData = 'grant_type=client_credentials';

        const tokenRes = await requestUrl('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData),
            },
            body: postData,
        }, 7000);

        if (tokenRes.status === 200) {
            const parsed = JSON.parse(tokenRes.data);
            cachedToken = parsed.access_token;
            tokenExpiresAt = Date.now() + ((parsed.expires_in || 3600) - 60) * 1000;
            return cachedToken;
        }
    } catch (e) {
        console.warn(`[Spotify] Failed to get API token: ${e.message}`);
    }
    return null;
}

/**
 * Resolve Spotify resource using official Spotify Web API
 */
async function resolveSpotifyViaApi(type, id, token) {
    const market = process.env.SPOTIFY_COUNTRY_CODE || 'US';
    try {
        let endpoint = '';
        if (type === 'track') endpoint = `https://api.spotify.com/v1/tracks/${id}?market=${market}`;
        else if (type === 'playlist') endpoint = `https://api.spotify.com/v1/playlists/${id}?market=${market}`;
        else if (type === 'album') endpoint = `https://api.spotify.com/v1/albums/${id}?market=${market}`;
        else if (type === 'artist') endpoint = `https://api.spotify.com/v1/artists/${id}/top-tracks?market=${market}`;

        if (!endpoint) return null;

        const res = await requestUrl(endpoint, {
            headers: { 'Authorization': `Bearer ${token}` }
        }, 8000);

        if (res.status === 200) {
            const data = JSON.parse(res.data);
            if (type === 'track') {
                const artist = data.artists?.map(a => a.name).join(', ') || '';
                return {
                    type: 'track',
                    title: data.name || '',
                    artist,
                    duration: data.duration_ms || 0,
                    searchQuery: `${data.name || ''} ${artist}`.trim(),
                    thumbnail: data.album?.images?.[0]?.url || null,
                    uri: data.external_urls?.spotify || `https://open.spotify.com/track/${id}`,
                };
            }

            if (type === 'playlist' || type === 'album') {
                const playlistName = data.name || (type === 'album' ? 'Spotify Album' : 'Spotify Playlist');
                const rawItems = type === 'playlist' ? (data.tracks?.items || []) : (data.tracks?.items || []);
                const tracks = rawItems.map(item => {
                    const t = item.track || item;
                    if (!t || !t.name) return null;
                    const artist = t.artists?.map(a => a.name).join(', ') || '';
                    return {
                        title: t.name,
                        artist,
                        duration: t.duration_ms || 0,
                        searchQuery: `${t.name} ${artist}`.trim(),
                        uri: t.external_urls?.spotify || `https://open.spotify.com/track/${t.id}`,
                    };
                }).filter(Boolean);

                return {
                    type: 'playlist',
                    name: playlistName,
                    author: data.owner?.display_name || data.artists?.[0]?.name || 'Spotify',
                    tracks,
                    thumbnail: data.images?.[0]?.url || null,
                    uri: data.external_urls?.spotify || `https://open.spotify.com/${type}/${id}`,
                };
            }

            if (type === 'artist') {
                const rawTracks = data.tracks || [];
                const artistName = rawTracks[0]?.artists?.[0]?.name || 'Artist';
                const tracks = rawTracks.map(t => {
                    const artist = t.artists?.map(a => a.name).join(', ') || artistName;
                    return {
                        title: t.name,
                        artist,
                        duration: t.duration_ms || 0,
                        searchQuery: `${t.name} ${artist}`.trim(),
                        uri: t.external_urls?.spotify || `https://open.spotify.com/track/${t.id}`,
                    };
                });

                return {
                    type: 'playlist',
                    name: `${artistName} - Top Tracks`,
                    author: artistName,
                    tracks,
                    thumbnail: rawTracks[0]?.album?.images?.[0]?.url || null,
                    uri: `https://open.spotify.com/artist/${id}`,
                };
            }
        }
    } catch (e) {
        console.warn(`[Spotify] API resolution error: ${e.message}`);
    }
    return null;
}

/**
 * Resolve Spotify resource by extracting embed metadata (__NEXT_DATA__)
 * Tokenless, fast, and does not require credentials
 */
async function resolveSpotifyViaEmbed(type, id) {
    try {
        const embedUrl = `https://open.spotify.com/embed/${type}/${id}`;
        const res = await requestUrl(embedUrl, {}, 8000);

        if (res.status === 200) {
            const match = res.data.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
            if (match) {
                const json = JSON.parse(match[1]);
                const entity = json.props?.pageProps?.state?.data?.entity;
                if (entity) {
                    if (type === 'track') {
                        const artist = entity.artists?.[0]?.name || entity.subtitle || '';
                        const title = entity.title || entity.name || '';
                        return {
                            type: 'track',
                            title,
                            artist,
                            duration: entity.duration || 0,
                            searchQuery: `${title} ${artist}`.trim(),
                            thumbnail: entity.visualIdentity?.image?.[0]?.url || null,
                            uri: `https://open.spotify.com/track/${id}`,
                        };
                    }

                    if (type === 'playlist' || type === 'album' || type === 'artist') {
                        const playlistName = entity.name || entity.title || (type === 'album' ? 'Spotify Album' : 'Spotify Playlist');
                        const author = entity.subtitle || (entity.artists?.[0]?.name) || 'Spotify';
                        const rawTracks = entity.trackList || [];
                        const tracks = rawTracks.map(t => {
                            const trackTitle = t.title || t.name || '';
                            const trackArtist = t.subtitle || (entity.type === 'artist' ? entity.name : '') || '';
                            return {
                                title: trackTitle,
                                artist: trackArtist,
                                duration: t.duration || 0,
                                searchQuery: `${trackTitle} ${trackArtist}`.trim(),
                                uri: t.uri ? (t.uri.startsWith('spotify:track:') ? `https://open.spotify.com/track/${t.uri.split(':')[2]}` : t.uri) : null,
                            };
                        }).filter(t => Boolean(t.title));

                        return {
                            type: 'playlist',
                            name: playlistName,
                            author,
                            tracks,
                            thumbnail: entity.coverArt?.sources?.[0]?.url || entity.visualIdentity?.image?.[0]?.url || null,
                            uri: `https://open.spotify.com/${type}/${id}`,
                        };
                    }
                }
            }
        }
    } catch (e) {
        console.warn(`[Spotify] Embed resolution error: ${e.message}`);
    }

    return null;
}

/**
 * Resolve track via Spotify oEmbed endpoint (secondary fallback for tracks)
 */
async function resolveSpotifyViaOEmbed(type, id) {
    if (type !== 'track') return null;

    try {
        const oEmbedUrl = `https://open.spotify.com/oembed?url=https://open.spotify.com/track/${id}`;
        const oRes = await requestUrl(oEmbedUrl, {}, 6000);
        if (oRes.status === 200) {
            const oData = JSON.parse(oRes.data);
            const title = oData.title || '';
            const artist = oData.author_name || '';
            return {
                type: 'track',
                title,
                artist,
                duration: 0,
                searchQuery: `${title} ${artist}`.trim(),
                thumbnail: oData.thumbnail_url || null,
                uri: `https://open.spotify.com/track/${id}`,
            };
        }
    } catch (e) {
        console.warn(`[Spotify] oEmbed fallback error: ${e.message}`);
    }

    return null;
}

/**
 * Resolve any Spotify track, playlist, album, or artist into metadata
 * Automatically tries:
 * 1. Official Web API if SPOTIFY_CLIENT_ID & SPOTIFY_CLIENT_SECRET are set
 * 2. Tokenless embed extraction (__NEXT_DATA__)
 * 3. oEmbed endpoint fallback (for tracks)
 *
 * @param {string} rawUrl - Spotify URL or URI
 * @returns {Promise<Object|null>}
 */
async function resolveSpotify(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;

    const expandedUrl = await expandSpotifyUrl(rawUrl);
    const parsed = parseSpotifyUrl(expandedUrl);
    if (!parsed) return null;

    // 1. Try official Spotify Web API if credentials are provided
    const token = await getSpotifyApiToken();
    if (token) {
        const apiResult = await resolveSpotifyViaApi(parsed.type, parsed.id, token);
        if (apiResult && (apiResult.type === 'track' || (apiResult.tracks && apiResult.tracks.length > 0))) {
            return apiResult;
        }
    }

    // 2. Fall back to tokenless embed extraction
    const embedResult = await resolveSpotifyViaEmbed(parsed.type, parsed.id);
    if (embedResult && (embedResult.type === 'track' || (embedResult.tracks && embedResult.tracks.length > 0))) {
        return embedResult;
    }

    // 3. Fall back to oEmbed for tracks
    if (parsed.type === 'track') {
        return await resolveSpotifyViaOEmbed(parsed.type, parsed.id);
    }

    return null;
}

module.exports = {
    parseSpotifyUrl,
    expandSpotifyUrl,
    resolveSpotify,
    requestUrl,
};
