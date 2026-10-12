const { truncate, cleanVideoTitle } = require('./helpers');

// ══════════════════════════════════════════════════════════════════
//  Reso — High-Fidelity Recommendation & Autoplay Engine
//  Features:
//    1. Language Preservation (Zero drift — locks to session language)
//    2. Vibe & Mood Matching (Mass, Melody, Chill, Sad, Rap)
//    3. Anti-Stagnation & Artist Cooldown (Rotates peer artists)
//    4. YouTube Music 5-Tier Search with Parallel Fallback
// ══════════════════════════════════════════════════════════════════

// ── Unicode Script Detection Patterns ─────────────────────────
const SCRIPT_PATTERNS = {
    tamil: /[\u0B80-\u0BFF]/,
    telugu: /[\u0C00-\u0C7F]/,
    malayalam: /[\u0D00-\u0D7F]/,
    kannada: /[\u0C80-\u0CFF]/,
    hindi: /[\u0900-\u097F]/,       // Devanagari
    punjabi: /[\u0A00-\u0A7F]/,     // Gurmukhi
    bengali: /[\u0980-\u09FF]/,
    korean: /[\uAC00-\uD7AF\u1100-\u11FF]/,
    japanese: /[\u3040-\u309F\u30A0-\u30FF]/,
};

// ── Known Record Labels / Channels Mapped to Language ─────────
const CHANNEL_LANGUAGES = {
    tamil: [
        'sony music south', 'think music', 'think indie', 'sun pictures', 'sun tv',
        'saregama tamil', 't-series tamil', 'divo', 'noise and grains', 'madras gig',
        'lahari tamil', 'muzik247 tamil', 'vijay television', 'zee music south',
        'trendloud', 'galatta', 'behindwoods', 'the route'
    ],
    telugu: [
        'aditya music', 'lahari music', 'saregama telugu', 't-series telugu',
        'mango music', 'madhura audio', 'shreyas media', 'mythri movie makers',
        'geetha arts', 'haasine & haarika'
    ],
    malayalam: [
        'muzik247', 'saregama malayalam', 'manorama music', 'goodwill entertainments',
        'saina music', 'millennium audios', 'satyam videos'
    ],
    hindi: [
        't-series', 'zee music company', 'sony music india', 'yrf', 'tips official',
        'speed records', 'white hill music', 'panchhi music', 'hitz music', 'eros now'
    ],
    kannada: [
        'anand audio', 'jhankar music', 'd beats', 'lahari music kannada', 'hombale films'
    ],
    punjabi: [
        'speed records', 'white hill music', 't-series apna punjab', 'times music punjabi',
        'geet mp3', 'single track studios'
    ],
};

// ── Prominent Artists, Composers & Singers Mapped to Primary Language ──
const ARTIST_LANGUAGES = {
    tamil: [
        'anirudh', 'anirudh ravichander', 'yuvan', 'yuvan shankar raja', 'harris jayaraj',
        'santhosh narayanan', 'd imman', 'd.imman', 'imman', 'gv prakash', 'g.v.prakash',
        'g v prakash', 'hiphop tamizha', 'hip hop tamizha', 'ilaiyaraaja', 'ilayaraja',
        'vidyasagar', 'sean roldan', 'sai abhyankkar', 'pradeep kumar', 'dhee',
        'anthony daasan', 'vijay antony', 'sam cs', 'arivu', 'asal kolaar', 'paal dabba',
        'dhanush', 'silambarasan', 'simbu', 'thalapathy vijay', 'rajinikanth',
        'sivakarthikeyan', 'stephen zechariah', 'haricharan', 'karthik', 'chinmayi',
        'shakthisree gopalan', 'bombay jayashri', 'sid sriram', 'jonita gandhi',
        'andrea jeremiah', 'leon james', 'c. sathya', 'c sathya', 'ofro', 'kaber vasuki'
    ],
    telugu: [
        'thaman', 's thaman', 's.thaman', 'devi sri prasad', 'dsp', 'mani sharma',
        'mickey j meyer', 'ram miriyala', 'anurag kulkarni', 'mangli', 'keeravani',
        'm.m.keeravani', 'm.m. keeravani', 'allu arjun', 'mahesh babu', 'ram charan',
        'jr ntr', 'pawan kalyan', 'chiranjeevi', 'vijay deverakonda', 'nani', 'vivek sagar',
        'chaitan bharadwaj', 'bheems ceciroleo'
    ],
    hindi: [
        'arijit singh', 'pritam', 'neha kakkar', 'badshah', 'shreya ghoshal',
        'vishal-shekhar', 'vishal shekhar', 'sachin-jigar', 'sachin jigar',
        'shankar ehsaan loy', 'vishal mishra', 'amit trivedi', 'jubin nautiyal',
        'atif aslam', 'sunidhi chauhan', 'sonu nigam', 'kk', 'mohit chauhan',
        'armaan malik', 'darshan raval', 'alka yagnik', 'kumar sanu', 'udit narayan',
        'honey singh', 'yo yo honey singh', 'b praak', 'jasleen royal', 'mithoon',
        'tanishk bagchi', 'shah rukh khan', 'salman khan', 'ranbir kapoor', 'ranveer singh',
        'akshay kumar', 'kartik aaryan', 'raftaar', 'divine', 'mc stan', 'king'
    ],
    malayalam: [
        'sushin shyam', 'jakes bejoy', 'shaan rahman', 'gopi sundar', 'deepak dev',
        'rex vijayan', 'hesham abdul wahab', 'dabzee', 'hanumankind', 'mohanlal',
        'mammootty', 'fahadh faasil', 'dulquer salmaan', 'nivin pauly', 'tovino thomas',
        'rajesh murugesan', 'vijay yesudas', 'vineeth sreenivasan', 'sithara krishnakumar'
    ],
    kannada: [
        'ravi basrur', 'charan raj', 'arjun janya', 'v harikrishna', 'v. harikrishna',
        'ajaneesh loknath', 'b ajaneesh loknath', 'yash', 'rishab shetty', 'rakshit shetty',
        'puneeth rajkumar', 'darshan', 'sudeep', 'raghu dixit', 'sanjith hegde'
    ],
    punjabi: [
        'diljit dosanjh', 'sidhu moose wala', 'sidhu moosewala', 'karan aujla',
        'ap dhillon', 'gurinder gill', 'shubh', 'amrinder gill', 'jaani', 'jassie gill',
        'harrdy sandhu', 'guru randhawa', 'amrit maan'
    ],
    english: [
        'the weeknd', 'taylor swift', 'drake', 'ed sheeran', 'ariana grande',
        'post malone', 'bruno mars', 'dua lipa', 'billie eilish', 'justin bieber',
        'eminem', 'kendrick lamar', 'travis scott', 'rihanna', 'coldplay',
        'imagine dragons', 'charlie puth', 'shawn mendes', 'olivia rodrigo',
        'harry styles', 'adele', 'maroon 5', 'katy perry', 'lady gaga',
        'selena gomez', 'sza', 'doja cat', 'sabrina carpenter', 'chappell roan',
        'benson boone', 'teddy swims', 'tate mcrae', 'lana del rey', 'beyoncé',
        'travis scott', 'future', 'metro boomin', '21 savage'
    ],
    korean: [
        'bts', 'blackpink', 'newjeans', 'twice', 'stray kids', 'seventeen',
        'exo', 'iu', 'txt', 'enhypen', 'red velvet', 'le sserafim', 'aespa', 'ive',
        'jungkook', 'jimin', 'agust d', 'lisa', 'jennie', 'rosé'
    ],
    japanese: [
        'yoasobi', 'kenshi yonezu', 'ado', 'radwimps', 'lisa', 'eve', 'king gnu',
        'fujii kaze', 'aimyon', 'one ok rock', 'official hige dandism'
    ]
};

// ── Language Specific Keywords & Movie Signatures ─────────────
const KEYWORD_LANGUAGES = {
    tamil: [
        'tamil', 'tamizh', 'kollywood', 'kuthu', 'marana mass', 'kaadhal', 'kadhal',
        'kanave', 'alappara', 'thaaru maaru', 'theri', 'vaathi', 'katchi sera', 'aasa kooda',
        'arabic kuthu', 'naa ready', 'chilla chilla', 'pathala pathala', 'chellamma', 'jailer',
        'leo', 'vikram', 'beast', 'master', 'varisu', 'mankatha', 'minnale', 'paiyaa',
        'vizhi', 'unakkaga', 'mazhai', 'idhayam', 'ghilli', 'pokkiri', 'annathe', 'bigil',
        'mersal', 'sarkar', 'viswasam', 'vedalam', 'ayalaan', 'captain miller', 'vada chennai',
        'asuran', 'karnan', 'soorarai pottru', 'jai bhim', 'raayan', 'amaran', 'vettaiyan',
        'goat', 'thuppakki', 'anirudh hits', 'yuvan hits', 'harris hits', 'ar rahman hits'
    ],
    telugu: [
        'telugu', 'tollywood', 'samajavaragamana', 'butta bomma', 'saranga dariya', 'oo antava',
        'srivalli', 'ramuloo', 'pushpa', 'devara', 'salaar', 'rrr', 'kalki', 'guntur kaaram',
        'chuttamalle', 'fear song', 'ala vaikunthapurramuloo', 'sarileru neekevvaru', 'geetha govindam',
        'waltair veerayya', 'veera simha reddy', 'dhamaka', 'sarkaru vaari paata'
    ],
    hindi: [
        'hindi', 'bollywood', 'aashiqui', 'chaleya', 'kesariya', 'shayari', 'jawan', 'pathaan',
        'animal', 'kabir singh', 'stree', 'dangal', 'shershaah', 'bhool bhulaiyaa', 'tum hi ho',
        'channa mereya', 'zinda banda', 'raataan lambiyan', 'leke prabhu ka naam', 'lut gaye',
        'apna bana le', 'teraa chehra', 'bedardeya', 'o maahi', 'tauba tauba'
    ],
    malayalam: [
        'malayalam', 'mollywood', 'malare', 'aaradhike', 'jeevamshamayi', 'neeyo',
        'manavalan thug', 'aavesham', 'premam', 'manjummel boys', 'illuminati', 'kumbalangi',
        'hridhyam', 'romancham', 'bheeshma parvam', 'thallumaala', 'arm'
    ],
    kannada: [
        'kannada', 'sandalwood', 'kgf', 'kantara', 'charlie 777', 'vikrant rona', 'kabzaa',
        'raajakumara', 'tagaru', 'salaam rocky bhai'
    ],
    punjabi: [
        'punjabi', 'pollywood', 'sidhu', 'moosewala', 'aujla', 'dhillon', 'shubh', 'dosanjh',
        'brown munde', 'elevated', 'cheques', 'baller', 'lover', 'g.o.a.t', 'proper patola',
        'softly', 'white brown black', 'insane'
    ],
    english: [
        'english', 'western', 'billboard', 'pop', 'synthpop', 'rock', 'hip hop', 'hip-hop', 'rap',
        'r&b', 'edm', 'house', 'acoustic', 'unplugged', 'feat.', 'ft.', 'remix', 'official video'
    ],
    korean: [
        'korean', 'kpop', 'k-pop', 'k-drama', 'ost'
    ],
    japanese: [
        'japanese', 'jpop', 'j-pop', 'anime', 'opening', 'ending', 'ost'
    ],
};

// ── Vibe / Mood Definitions & Keywords ────────────────────────
const VIBE_CATEGORIES = {
    mass: {
        id: 'mass',
        label: '⚡ High Energy / Mass',
        keywords: [
            'mass', 'kuthu', 'gaana', 'item', 'intro', 'thalapathy', 'thala', 'beast',
            'bigil', 'mersal', 'leo', 'goat', 'master', 'dance', 'party', 'club', 'beat',
            'fast', 'dj', 'remix', 'dhol', 'bass', 'energetic', 'alappara', 'verithanam',
            'marana mass', 'naa ready', 'chilla chilla', 'pathala pathala', 'badass',
            'tauba tauba', 'dhoom', 'swag', 'power', 'anthem', 'theme'
        ],
        searchTerms: {
            tamil: 'tamil energetic mass hit songs',
            hindi: 'bollywood dance party hits',
            telugu: 'telugu mass beat hits',
            malayalam: 'malayalam fast beat hits',
            punjabi: 'punjabi high energy party hits',
            english: 'high energy dance pop hits',
        }
    },
    melody: {
        id: 'melody',
        label: '💖 Melody / Romance',
        keywords: [
            'melody', 'love', 'romantic', 'kadhal', 'kaadhal', 'kanave', 'unakkaga',
            'mazhai', 'idhayam', 'vizhi', 'pyaar', 'dil', 'ishq', 'mohabbat', 'tum hi',
            'tere bina', 'acoustic', 'unplugged', 'soft', 'sweet', 'soul', 'slow',
            'vaseegara', 'en kadhal solla', 'katchi sera', 'aasa kooda', 'kesariya',
            'chaleya', 'malare', 'samajavaragamana', 'srivalli', 'apna bana le'
        ],
        searchTerms: {
            tamil: 'tamil melody hit songs',
            hindi: 'bollywood romantic melody hits',
            telugu: 'telugu melody love hits',
            malayalam: 'malayalam melody love hits',
            punjabi: 'punjabi romantic love songs',
            english: 'acoustic love songs hits',
        }
    },
    sad: {
        id: 'sad',
        label: '🌧️ Emotional / Soulful',
        keywords: [
            'sad', 'breakup', 'pain', 'vidalai', 'pirivu', 'alone', 'cry', 'tears',
            'heartbreak', 'sorrow', 'dard', 'judaai', 'tadap', 'channa mereya',
            'kanave kanave', 'pogathe', 'kannazhaga', 'emotional', 'unforgiven'
        ],
        searchTerms: {
            tamil: 'tamil emotional breakup hit songs',
            hindi: 'bollywood sad emotional hits',
            telugu: 'telugu emotional sad hits',
            malayalam: 'malayalam emotional sad hits',
            punjabi: 'punjabi sad emotional songs',
            english: 'sad emotional breakup songs',
        }
    },
    chill: {
        id: 'chill',
        label: '🌿 Chill / Indie Vibe',
        keywords: [
            'chill', 'lofi', 'lo-fi', 'indie', 'vibe', 'breeze', 'coffee', 'drive',
            'feel good', 'relax', 'night drive', 'acoustic', 'aesthetic', 'ambient',
            'sunset', 'unwind', 'think indie', 'madras gig'
        ],
        searchTerms: {
            tamil: 'tamil chill indie vibe songs',
            hindi: 'hindi indie chill songs',
            telugu: 'telugu indie chill hits',
            malayalam: 'malayalam indie chill hits',
            punjabi: 'punjabi chill lofi hits',
            english: 'chill lofi vibe pop hits',
        }
    },
    rap: {
        id: 'rap',
        label: '🎤 Rap / Hip-Hop',
        keywords: [
            'rap', 'hip hop', 'hiphop', 'freestyle', 'bars', 'cypher', 'drill',
            'trap', 'flow', 'desi hip hop', 'underground', 'boom bap'
        ],
        searchTerms: {
            tamil: 'tamil rap hip hop hits',
            hindi: 'desi hip hop rap hits',
            telugu: 'telugu rap hits',
            malayalam: 'malayalam rap hits',
            punjabi: 'punjabi rap hip hop hits',
            english: 'hip hop rap hits',
        }
    },
};

// ── Peer Artist Ecosystem (Ensures Artist Variety Without Changing Vibe) ──
const PEER_ARTISTS = {
    // Tamil Ecosystem
    'anirudh': ['Yuvan Shankar Raja', 'Santhosh Narayanan', 'Harris Jayaraj', 'GV Prakash Kumar', 'Hip Hop Tamizha', 'Sam CS', 'AR Rahman'],
    'anirudh ravichander': ['Yuvan Shankar Raja', 'Santhosh Narayanan', 'Harris Jayaraj', 'GV Prakash Kumar', 'Hip Hop Tamizha', 'Sam CS', 'AR Rahman'],
    'yuvan': ['Harris Jayaraj', 'Anirudh Ravichander', 'Santhosh Narayanan', 'GV Prakash Kumar', 'AR Rahman'],
    'yuvan shankar raja': ['Harris Jayaraj', 'Anirudh Ravichander', 'Santhosh Narayanan', 'GV Prakash Kumar', 'AR Rahman'],
    'harris jayaraj': ['Yuvan Shankar Raja', 'AR Rahman', 'Anirudh Ravichander', 'GV Prakash Kumar'],
    'ar rahman': ['Harris Jayaraj', 'Yuvan Shankar Raja', 'Ilaiyaraaja', 'Vidyasagar', 'Santhosh Narayanan'],
    'santhosh narayanan': ['Anirudh Ravichander', 'Sean Roldan', 'Yuvan Shankar Raja', 'GV Prakash Kumar', 'Sam CS'],
    'gv prakash': ['Yuvan Shankar Raja', 'Anirudh Ravichander', 'Harris Jayaraj', 'D Imman'],
    'gv prakash kumar': ['Yuvan Shankar Raja', 'Anirudh Ravichander', 'Harris Jayaraj', 'D Imman'],
    'hiphop tamizha': ['Anirudh Ravichander', 'Santhosh Narayanan', 'GV Prakash Kumar'],
    'hip hop tamizha': ['Anirudh Ravichander', 'Santhosh Narayanan', 'GV Prakash Kumar'],
    'd imman': ['GV Prakash Kumar', 'Vidyasagar', 'Yuvan Shankar Raja'],
    'ilaiyaraaja': ['AR Rahman', 'Deva', 'Vidyasagar', 'SPB'],
    'sai abhyankkar': ['Sean Roldan', 'Asal Kolaar', 'Think Indie', 'OfRo', 'Stephen Zechariah'],

    // Hindi Ecosystem
    'arijit singh': ['Atif Aslam', 'Mohit Chauhan', 'KK', 'Vishal Mishra', 'Jubin Nautiyal', 'Armaan Malik'],
    'pritam': ['Vishal-Shekhar', 'Sachin-Jigar', 'Shankar Ehsaan Loy', 'Amit Trivedi'],
    'badshah': ['Honey Singh', 'Divine', 'King', 'Raftaar', 'Karan Aujla'],
    'neha kakkar': ['Dhvani Bhanushali', 'Tulsi Kumar', 'Sunidhi Chauhan', 'Mika Singh'],
    'vishal mishra': ['Arijit Singh', 'B Praak', 'Jubin Nautiyal', 'Armaan Malik'],

    // English Ecosystem
    'the weeknd': ['Bruno Mars', 'Post Malone', 'Dua Lipa', 'Daft Punk', 'Zayn'],
    'taylor swift': ['Olivia Rodrigo', 'Sabrina Carpenter', 'Billie Eilish', 'Ariana Grande'],
    'drake': ['Travis Scott', 'Kendrick Lamar', '21 Savage', 'Post Malone', 'Metro Boomin'],
    'ed sheeran': ['Shawn Mendes', 'Charlie Puth', 'Lewis Capaldi', 'James Arthur'],
    'billie eilish': ['Olivia Rodrigo', 'Lana Del Rey', 'Lorde', 'Phoebe Bridgers'],
    'coldplay': ['Imagine Dragons', 'OneRepublic', 'The Script', 'Maroon 5'],
    'sabrina carpenter': ['Olivia Rodrigo', 'Chappell Roan', 'Dua Lipa', 'Tate McRae'],
};

// Default peer lists per language when artist isn't specifically mapped
const DEFAULT_LANGUAGE_PEERS = {
    tamil: ['Yuvan Shankar Raja', 'Santhosh Narayanan', 'Harris Jayaraj', 'GV Prakash Kumar', 'AR Rahman', 'Anirudh Ravichander', 'Sean Roldan', 'Hip Hop Tamizha'],
    hindi: ['Arijit Singh', 'Atif Aslam', 'Mohit Chauhan', 'KK', 'Vishal Mishra', 'Pritam', 'Sachin-Jigar', 'Armaan Malik'],
    telugu: ['Thaman S', 'Devi Sri Prasad', 'Mickey J Meyer', 'Mani Sharma', 'Ram Miriyala', 'Anurag Kulkarni', 'M.M. Keeravaani'],
    malayalam: ['Sushin Shyam', 'Jakes Bejoy', 'Shaan Rahman', 'Gopi Sundar', 'Hesham Abdul Wahab', 'Dabzee', 'Rex Vijayan'],
    kannada: ['Ravi Basrur', 'Charan Raj', 'Arjun Janya', 'Ajaneesh Loknath'],
    punjabi: ['Diljit Dosanjh', 'Karan Aujla', 'AP Dhillon', 'Shubh', 'Amrinder Gill', 'Sidhu Moose Wala'],
    english: ['The Weeknd', 'Bruno Mars', 'Post Malone', 'Dua Lipa', 'Taylor Swift', 'Olivia Rodrigo', 'Sabrina Carpenter', 'Ed Sheeran'],
    korean: ['BTS', 'NewJeans', 'BLACKPINK', 'SEVENTEEN', 'Stray Kids', 'TWICE'],
    japanese: ['YOASOBI', 'Kenshi Yonezu', 'Ado', 'RADWIMPS', 'King Gnu', 'Fujii Kaze'],
};

// ── Known Indian music composers for title parsing ────────────
const KNOWN_COMPOSERS = [
    'anirudh', 'anirudh ravichander', 'a.r. rahman', 'ar rahman', 'a r rahman',
    'yuvan', 'yuvan shankar raja', 'harris jayaraj', 'harris', 'hip hop tamizha',
    'hiphop tamizha', 'santhosh narayanan', 'sam cs', 'd.imman', 'd imman', 'imman',
    'g.v.prakash', 'gv prakash', 'g v prakash', 'devi sri prasad', 'dsp',
    'thaman', 's.thaman', 's thaman', 'vidyasagar', 'ilaiyaraaja', 'ilayaraja',
    'sean roldan', 'c. sathya', 'leon james', 'sid sriram', 'pritam',
    'vishal mishra', 'arijit singh', 'amit trivedi', 'shankar ehsaan loy',
    'mani sharma', 'mickey j meyer', 'rockstar devi sri prasad', 'sai abhyankkar',
];

const LABEL_PATTERNS = /\b(vevo|official|channel|studio|records|recordings|music|tv|media|productions?|entertainment|films?|pictures|movies?|pvt|ltd|limited|inc|digital|network|south|label)\b/gi;
const TOPIC_SUFFIX = /\s*-\s*Topic$/i;

// ── Session State Storage (Guild ID -> { language, vibe, userTracks, updatedAt }) ──
const guildSessionState = new Map();

// ── Recommendation Cache (CacheKey -> { timestamp, recommendations }) ─────────
const recommendationCache = new Map();
const REC_CACHE_TTL_MS = 30 * 60 * 1000;

// ══════════════════════════════════════════════════════════════════
//  TITLE CLEANING & PARSING
// ══════════════════════════════════════════════════════════════════

/**
 * Universal video descriptor remover
 */
function stripVideoJunk(text = '') {
    if (!text) return '';
    return text
        .replace(/[\(\[\{].*?[\)\]\}]/g, '')  // remove (...) [...] {...}
        .replace(/\b(official|music|video|audio|lyric|lyrics|full song|hd|4k|1080p|remastered|visualizer|status|shorts|video song|lyric video|4k video|uhd|teaser|trailer|song|songs|promo|jukebox|making|bts|behind the scenes)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Clean song title — extracts just the song name
 */
function cleanSongTitle(title = '') {
    const firstPart = title.split(/\||-|:|\/(?![\/])/)[0] || title;
    return stripVideoJunk(firstPart) || title;
}

/**
 * Clean up channel/author name to extract real artist name
 */
function cleanAuthor(author = '') {
    if (!author) return '';
    return author
        .replace(TOPIC_SUFFIX, '')
        .replace(LABEL_PATTERNS, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Enhanced Algorithmic Title Metadata Parser
 */
function parseTrackMetadata(title = '', author = '') {
    let songName = '';
    let movieOrAlbum = null;
    let primaryArtist = null;
    let secondaryArtist = null;
    let detectedComposer = null;

    // Step 1: Try to extract movie from "(From X)" pattern
    const fromMatch = title.match(/\((?:From\s+)?[""]?(.+?)[""]?\)\s*$/i);
    if (fromMatch) {
        movieOrAlbum = stripVideoJunk(fromMatch[1]).trim() || null;
    }

    // Step 2: Remove the "(From X)" part from title for further parsing
    const titleWithoutFrom = title.replace(/\s*\((?:From\s+)?[""]?.+?[""]?\)\s*$/i, '').trim();

    // Step 3: Split by delimiters |, -, :, /
    const rawSegments = titleWithoutFrom.split(/\||-|:|\/(?!\/)/).map(s => s.trim()).filter(Boolean);
    const cleanedSegments = rawSegments.map(s => stripVideoJunk(s)).filter(s => s.length > 0);

    // Step 4: Detect composer from any segment
    for (const seg of cleanedSegments) {
        const segLower = seg.toLowerCase();
        for (const composer of KNOWN_COMPOSERS) {
            if (segLower.includes(composer)) {
                detectedComposer = seg.trim();
                break;
            }
        }
        if (detectedComposer) break;
    }

    // Step 5: Parse based on segment count
    if (cleanedSegments.length === 0) {
        songName = stripVideoJunk(title) || title;
    } else if (cleanedSegments.length === 1) {
        songName = cleanedSegments[0];
    } else if (cleanedSegments.length === 2) {
        if (title.includes(' - ') && !title.includes('|')) {
            primaryArtist = cleanedSegments[0];
            songName = cleanedSegments[1];
        } else {
            songName = cleanedSegments[0];
            const seg1Lower = cleanedSegments[1].toLowerCase();
            const isComposer = KNOWN_COMPOSERS.some(c => seg1Lower.includes(c));
            if (isComposer) {
                detectedComposer = detectedComposer || cleanedSegments[1];
                primaryArtist = cleanedSegments[1];
            } else {
                if (!movieOrAlbum) movieOrAlbum = cleanedSegments[1];
                else primaryArtist = cleanedSegments[1];
            }
        }
    } else {
        if (title.includes(' - ') && !title.includes('|')) {
            primaryArtist = cleanedSegments[0];
            songName = cleanedSegments[1];
            if (!movieOrAlbum) movieOrAlbum = cleanedSegments[2] || null;
        } else {
            songName = cleanedSegments[0];
            if (!movieOrAlbum) movieOrAlbum = cleanedSegments[1];
            for (let i = 2; i < cleanedSegments.length; i++) {
                const segLower = cleanedSegments[i].toLowerCase();
                const isComposer = KNOWN_COMPOSERS.some(c => segLower.includes(c));
                if (isComposer && !detectedComposer) {
                    detectedComposer = cleanedSegments[i];
                } else if (!primaryArtist) {
                    primaryArtist = cleanedSegments[i];
                } else if (!secondaryArtist) {
                    secondaryArtist = cleanedSegments[i];
                }
            }
        }
    }

    // Fallbacks using channel/author
    const cleanedAuthorName = cleanAuthor(author);
    if (!primaryArtist && cleanedAuthorName) {
        primaryArtist = cleanedAuthorName;
    }
    if (!detectedComposer) {
        const authorLower = (cleanedAuthorName || '').toLowerCase();
        for (const composer of KNOWN_COMPOSERS) {
            if (authorLower.includes(composer)) {
                detectedComposer = cleanedAuthorName;
                break;
            }
        }
    }

    if (!songName) songName = stripVideoJunk(title) || 'Song';
    if (!primaryArtist) primaryArtist = detectedComposer || songName;

    return {
        songName,
        movieOrAlbum,
        primaryArtist,
        secondaryArtist: secondaryArtist || null,
        composer: detectedComposer || null,
    };
}

// ══════════════════════════════════════════════════════════════════
//  LANGUAGE & VIBE DETECTION
// ══════════════════════════════════════════════════════════════════

/**
 * Detect language using multi-layer signals:
 * 1. Unicode script detection
 * 2. Explicit language tag (e.g., "(Tamil)", "Tamil Song")
 * 3. Channel / Record label mapping
 * 4. Artist / Composer mapping
 * 5. Distinctive title & movie keywords
 */
function detectLanguage(title = '', author = '', fallbackLang = null) {
    const combined = `${title} ${author}`.toLowerCase();

    // 1. Script detection (100% certainty)
    for (const [lang, regex] of Object.entries(SCRIPT_PATTERNS)) {
        if (regex.test(title) || regex.test(author)) {
            return lang;
        }
    }

    // 2. Explicit tag detection (e.g. "Tamil", "Kollywood")
    for (const lang of Object.keys(KEYWORD_LANGUAGES)) {
        const explicitRegex = new RegExp(`(\\b|\\(|\\[)${lang}(\\b|\\)|\\]|\\s*song|\\s*video|\\s*hits)`, 'i');
        if (explicitRegex.test(combined)) {
            return lang;
        }
    }

    // 3. Channel / Label detection
    for (const [lang, channels] of Object.entries(CHANNEL_LANGUAGES)) {
        for (const ch of channels) {
            if (combined.includes(ch)) {
                return lang;
            }
        }
    }

    // 4. Prominent Artist detection
    for (const [lang, artists] of Object.entries(ARTIST_LANGUAGES)) {
        for (const artist of artists) {
            if (combined.includes(artist)) {
                return lang;
            }
        }
    }

    // 5. Keyword & Movie signatures
    for (const [lang, keywords] of Object.entries(KEYWORD_LANGUAGES)) {
        for (const kw of keywords) {
            if (combined.includes(kw)) {
                return lang;
            }
        }
    }

    // 6. If fallback language provided, preserve it
    if (fallbackLang) return fallbackLang;

    // Do not infer English merely because a title uses Latin characters.
    // Romanized Tamil/Hindi/etc. titles (e.g. "Devan Magale") are common;
    // unknown language should stay unknown rather than locking autoplay to English.
    return null;
}

/**
 * Detect vibe/mood of a track
 */
function detectVibe(title = '', author = '') {
    const combined = `${title} ${author}`.toLowerCase();

    for (const [vibeId, vibeData] of Object.entries(VIBE_CATEGORIES)) {
        if (vibeData.keywords.some(kw => combined.includes(kw))) {
            return vibeId;
        }
    }

    return null; // Unknown vibe: do not invent a mood
}

/**
 * Combined language and genre/vibe detection for backward compatibility
 */
function detectLanguageAndGenre(title = '', author = '', sessionLanguage = null) {
    const language = detectLanguage(title, author, sessionLanguage);
    const vibe = detectVibe(title, author);
    return { language, genre: vibe };
}

/**
 * Strict language match & drift filter:
 * Returns true if candidate track matches target language, false if it belongs to another language.
 */
function isLanguageMatch(candidateTitle = '', candidateAuthor = '', targetLanguage = null) {
    if (!targetLanguage) return true;

    const lowerTitle = candidateTitle.toLowerCase();
    const lowerAuthor = candidateAuthor.toLowerCase();
    const combined = `${lowerTitle} ${lowerAuthor}`;

    // 1. Explicit foreign language indicators
    const otherLanguages = ['tamil', 'telugu', 'hindi', 'malayalam', 'kannada', 'punjabi', 'korean', 'japanese']
        .filter(l => l !== targetLanguage);

    for (const otherLang of otherLanguages) {
        const explicitOtherRegex = new RegExp(`(\\b|\\(|\\[)${otherLang}(\\b|\\)|\\]|\\s*version|\\s*song)`, 'i');
        if (explicitOtherRegex.test(combined)) {
            return false; // Explicitly marked as another language
        }
    }

    // 2. Foreign Unicode scripts check
    for (const [lang, regex] of Object.entries(SCRIPT_PATTERNS)) {
        if (lang !== targetLanguage && (regex.test(candidateTitle) || regex.test(candidateAuthor))) {
            return false; // Contains foreign script
        }
    }

    // 3. Known foreign exclusive channels
    if (targetLanguage === 'tamil') {
        const hindiExclusive = ['t-series', 'zee music company', 'yrf', 'tips official', 'sony music india'];
        const teluguExclusive = ['aditya music', 'mango music', 'madhura audio'];
        if (hindiExclusive.some(ch => lowerAuthor.includes(ch)) && !combined.includes('tamil') && !combined.includes('south')) {
            return false;
        }
        if (teluguExclusive.some(ch => lowerAuthor.includes(ch)) && !combined.includes('tamil')) {
            return false;
        }
    } else if (targetLanguage === 'english') {
        const indianChannels = ['t-series', 'zee music', 'sony music south', 'sony music india', 'think music', 'aditya music', 'saregama'];
        if (indianChannels.some(ch => lowerAuthor.includes(ch)) || /[\u0900-\u0DFF]/.test(candidateTitle)) {
            return false;
        }
    } else if (targetLanguage === 'hindi') {
        const southChannels = ['sony music south', 'think music', 'aditya music', 'mango music', 'saregama tamil', 'saregama telugu'];
        if (southChannels.some(ch => lowerAuthor.includes(ch)) && !combined.includes('hindi')) {
            return false;
        }
    }

    return true;
}

// ══════════════════════════════════════════════════════════════════
//  SESSION STATE MANAGEMENT
// ══════════════════════════════════════════════════════════════════

/**
 * Update the session language and vibe when a user queues a track
 */
function updateSessionState(guildId, track) {
    if (!guildId || !track || !track.info) return;

    const rawTitle = track.info.title || '';
    const rawAuthor = track.info.author || '';

    const lang = detectLanguage(rawTitle, rawAuthor);
    const vibe = detectVibe(rawTitle, rawAuthor);

    const existing = guildSessionState.get(guildId) || {
        language: null,
        vibe: null,
        userTracks: [],
        updatedAt: Date.now()
    };

    if (lang) {
        existing.language = lang;
    }
    if (vibe) {
        existing.vibe = vibe;
    }

    existing.userTracks.push({
        title: rawTitle,
        author: rawAuthor,
        lang,
        vibe,
        timestamp: Date.now()
    });
    if (existing.userTracks.length > 20) {
        existing.userTracks.shift();
    }

    existing.updatedAt = Date.now();
    guildSessionState.set(guildId, existing);
}

/**
 * Get active session language for a guild, falling back to history consensus
 */
function getSessionLanguage(guildId, history = []) {
    const session = guildSessionState.get(guildId);
    if (session && session.language) {
        return session.language;
    }

    // Inspect user-initiated tracks in history first
    const userTracks = history.filter(t => t.requester && t.requester.id !== 'autoplay');
    const tracksToAnalyze = userTracks.length > 0 ? userTracks : history;

    const langCounts = {};
    for (let i = tracksToAnalyze.length - 1; i >= 0; i--) {
        const t = tracksToAnalyze[i];
        const lang = detectLanguage(t.info?.title || '', t.info?.author || '');
        if (lang) {
            langCounts[lang] = (langCounts[lang] || 0) + 1;
        }
    }

    let topLang = null;
    let maxCount = 0;
    for (const [lang, count] of Object.entries(langCounts)) {
        if (count > maxCount) {
            topLang = lang;
            maxCount = count;
        }
    }

    return topLang || null;
}

// ══════════════════════════════════════════════════════════════════
//  DEDUPLICATION & SCORING
// ══════════════════════════════════════════════════════════════════

/**
 * Fuzzy title match — returns true if titles are too similar
 */
function isFuzzyDuplicate(titleA, titleB) {
    if (!titleA || !titleB) return false;

    // Be conservative: substring matching incorrectly merges distinct tracks
    // such as "Love Story" and "Love Story 2026". Normalize common upload
    // descriptors, then require the actual song titles to match.
    const normalize = (value) => String(value)
        .toLowerCase()
        .replace(/[\(\[\{].*?[\)\]\}]/g, ' ')
        .replace(/\b(official|music|video|audio|lyric|lyrics|full|song|songs|hd|4k|remastered|visualizer|mv)\b/g, ' ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const a = normalize(titleA);
    const b = normalize(titleB);
    return Boolean(a && b && a === b);
}

// ══════════════════════════════════════════════════════════════════
//  SEARCH QUERIES GENERATION FOR /recommend COMMAND
// ══════════════════════════════════════════════════════════════════

function buildSearchQueries(meta, langGenre) {
    const queries = [];
    const { songName, movieOrAlbum, primaryArtist, secondaryArtist, composer } = meta;
    const { language, genre } = langGenre;
    const langTag = language || '';

    // Tier 1: Collaboration group (composer × artist combo)
    if (composer && primaryArtist && composer.toLowerCase() !== primaryArtist.toLowerCase()) {
        queries.push({
            query: `${composer} ${primaryArtist} songs ${langTag}`.trim(),
            tier: 'COLLAB',
            label: `🎧 ${truncate(composer, 15)} × ${truncate(primaryArtist, 15)}`,
            count: 1,
        });
    }

    // Tier 2: Same movie / album
    if (movieOrAlbum) {
        queries.push({
            query: `${movieOrAlbum} songs ${langTag}`.trim(),
            tier: 'MOVIE_ALBUM',
            label: `🎬 From ${truncate(movieOrAlbum, 18)}`,
            count: 1,
        });
    }

    // Tier 3: Similar Vibe / Genre
    if (language) {
        const vibeQuery = VIBE_CATEGORIES[genre]?.searchTerms[language] || `${language} ${genre} hit songs`;
        queries.push({
            query: vibeQuery,
            tier: 'GENRE',
            label: `🔥 Similar Vibe • ${language.toUpperCase()}`,
            count: 2,
        });
    } else {
        queries.push({
            query: `songs like ${songName}`,
            tier: 'GENRE',
            label: `🔥 Similar Vibe`,
            count: 2,
        });
    }

    // Tier 4: Primary artist / singer
    if (primaryArtist) {
        queries.push({
            query: `${primaryArtist} hit songs ${langTag}`.trim(),
            tier: 'ARTIST',
            label: `🎤 By ${truncate(primaryArtist, 18)}`,
            count: 1,
        });
    }

    // Tier 5: Peer artist in same language
    const artistKey = (composer || primaryArtist || '').toLowerCase();
    const peers = PEER_ARTISTS[artistKey] || (language && DEFAULT_LANGUAGE_PEERS[language]) || [];
    if (peers.length > 0) {
        const peer = peers[0];
        queries.push({
            query: `${peer} ${langTag} hit songs`.trim(),
            tier: 'DISCOVERY',
            label: `✨ ${truncate(peer, 18)} Hits`,
            count: 1,
        });
    }

    return queries;
}

// ══════════════════════════════════════════════════════════════════
//  MAIN RECOMMENDATION ENGINE (For /recommend & Now Playing)
// ══════════════════════════════════════════════════════════════════

/**
 * Fetch 5 structured recommendations with strict language consistency and diversity
 */
async function getRecommendations(player, currentTrack, limit = 5, sessionHistory = []) {
    if (!player || !currentTrack || !currentTrack.info) return [];

    const info = currentTrack.info;
    const rawTitle = info.title || '';
    const rawAuthor = info.author || '';

    // Step 1: Parse track metadata & determine target language
    const meta = parseTrackMetadata(rawTitle, rawAuthor);
    const targetLanguage = getSessionLanguage(player.guildId, sessionHistory) || detectLanguage(rawTitle, rawAuthor);
    const langGenre = detectLanguageAndGenre(rawTitle, rawAuthor, targetLanguage);

    // Step 2: Build exclusion set
    const excludedIdentifiers = new Set();
    const excludedTitles = new Set();

    if (info.uri) excludedIdentifiers.add(info.uri);
    if (info.identifier) excludedIdentifiers.add(info.identifier);
    excludedTitles.add(rawTitle.toLowerCase());
    excludedTitles.add(meta.songName.toLowerCase());

    if (player.queue && player.queue.tracks) {
        for (const t of player.queue.tracks) {
            if (t.info?.uri) excludedIdentifiers.add(t.info.uri);
            if (t.info?.identifier) excludedIdentifiers.add(t.info.identifier);
            if (t.info?.title) excludedTitles.add(t.info.title.toLowerCase());
        }
    }

    for (const t of sessionHistory) {
        if (t.info?.uri) excludedIdentifiers.add(t.info.uri);
        if (t.info?.identifier) excludedIdentifiers.add(t.info.identifier);
        if (t.info?.title) excludedTitles.add(t.info.title.toLowerCase());
    }

    // Cache lookup
    const cacheKey = `${(meta.songName || rawTitle).toLowerCase()}::${targetLanguage || ''}::${(cleanAuthor(rawAuthor) || '').toLowerCase()}`;
    const cached = recommendationCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < REC_CACHE_TTL_MS) && cached.recommendations?.length > 0) {
        const freshFromCache = cached.recommendations.filter(t =>
            !excludedIdentifiers.has(t.info?.uri) &&
            !excludedIdentifiers.has(t.info?.identifier) &&
            !excludedTitles.has((t.info?.title || '').toLowerCase())
        );
        if (freshFromCache.length >= limit) {
            return freshFromCache.slice(0, limit);
        }
    }

    // Step 3: Get search node
    let searchNode = null;
    const allNodes = player.lavalinkManager?.nodeManager?.nodes;
    if (allNodes && allNodes.size > 1) {
        for (const [, n] of allNodes) {
            if (n.connected && (!player.node || n.id !== player.node.id)) {
                searchNode = n;
                break;
            }
        }
    }
    if (!searchNode) {
        searchNode = player.node || (allNodes?.values()?.next()?.value);
    }
    if (!searchNode || !searchNode.connected) return [];

    // Step 4: Build search queries (run up to 4 diverse tiers)
    const queries = buildSearchQueries(meta, langGenre).slice(0, 4);

    // Step 5: Execute searches in parallel
    const searchPromises = queries.map(async (q) => {
        try {
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Recommendation search timeout')), 12000)
            );

            const searchExec = (async () => {
                let res = await searchNode.search({ query: q.query, source: 'ytmsearch' }, currentTrack.requester).catch(() => null);
                if (!res || !res.tracks || res.tracks.length === 0) {
                    res = await searchNode.search({ query: q.query, source: 'ytsearch' }, currentTrack.requester).catch(() => null);
                }
                return res;
            })();

            const result = await Promise.race([searchExec, timeoutPromise]).catch(() => null);
            return {
                tier: q.tier,
                label: q.label,
                count: q.count,
                tracks: result?.tracks || [],
            };
        } catch {
            return { tier: q.tier, label: q.label, count: q.count, tracks: [] };
        }
    });

    const results = await Promise.allSettled(searchPromises);

    // Step 6: Collect and deduplicate tracks with strict language guard
    const finalRecommendations = [];
    const addedTitles = new Set([...excludedTitles]);
    const addedIdentifiers = new Set([...excludedIdentifiers]);

    function tryAdd(track, label) {
        if (!track || !track.info) return false;

        const uri = track.info.uri;
        const id = track.info.identifier;
        const titleLower = (track.info.title || '').toLowerCase();
        const authorLower = (track.info.author || '').toLowerCase();

        if (addedIdentifiers.has(uri) || addedIdentifiers.has(id)) return false;

        // Language guard: reject if foreign language markers detected
        if (targetLanguage && !isLanguageMatch(track.info.title, track.info.author, targetLanguage)) {
            return false;
        }

        // Fuzzy title dedup
        for (const existing of addedTitles) {
            if (isFuzzyDuplicate(titleLower, existing)) return false;
        }

        // Duration guard: 60s to 15min
        const duration = track.info.duration || 0;
        if (duration > 0 && (duration < 60000 || duration > 900000)) return false;

        addedIdentifiers.add(uri);
        addedIdentifiers.add(id);
        addedTitles.add(titleLower);

        track.categoryLabel = label;
        track.isRecommendation = true;
        finalRecommendations.push(track);
        return true;
    }

    // First pass: tier by tier to ensure diversity
    for (const settled of results) {
        if (settled.status !== 'fulfilled') continue;
        const { label, count, tracks } = settled.value;

        let added = 0;
        for (const track of tracks) {
            if (added >= count) break;
            if (finalRecommendations.length >= limit) break;
            if (tryAdd(track, label)) added++;
        }
    }

    // Second pass: fill remaining slots
    if (finalRecommendations.length < limit) {
        for (const settled of results) {
            if (settled.status !== 'fulfilled') continue;
            if (finalRecommendations.length >= limit) break;
            const { label, tracks } = settled.value;

            for (const track of tracks) {
                if (finalRecommendations.length >= limit) break;
                tryAdd(track, label);
            }
        }
    }

    // Cache results
    if (finalRecommendations.length > 0) {
        if (recommendationCache.size >= 100) {
            const oldestKey = recommendationCache.keys().next().value;
            recommendationCache.delete(oldestKey);
        }
        recommendationCache.set(cacheKey, {
            timestamp: Date.now(),
            recommendations: finalRecommendations.slice(0, 10),
        });
    }

    return finalRecommendations.slice(0, limit);
}

// ══════════════════════════════════════════════════════════════════
//  AUTOPLAY ENGINE: SIMILAR VIBE & ARTIST DIVERSITY
// ══════════════════════════════════════════════════════════════════

/**
 * Get the next best track for autoplay.
 * Solves:
 *   1. Language Drift: Strictly anchors to session language
 *   2. Artist Stagnation: Prevents back-to-back repeats of the same artist, rotating peers
 *   3. Similar Vibe: Matches the musical energy (mass, melody, chill, etc.)
 *
 * @param {Object} player - Lavalink player
 * @param {Map} trackHistoryMap - client.trackHistory
 * @returns {Object|null} Selected track or null
 */
async function getAutoplayTrack(player, trackHistoryMap) {
    if (!player) return null;

    const guildId = player.guildId;
    const history = trackHistoryMap?.get(guildId) || [];
    const lastTrack = history[history.length - 1];

    if (!lastTrack || !lastTrack.info) return null;

    // ── 1. Resolve Target Language (Zero Drift Anchor) ──
    const targetLanguage = getSessionLanguage(guildId, history) ||
        detectLanguage(lastTrack.info?.title || '', lastTrack.info?.author || '');

    // ── 2. Resolve Vibe / Mood of the Session ──
    const recentHistory = history.slice(-8);
    const vibeCounts = {};
    for (const item of recentHistory) {
        const vibe = detectVibe(item.info?.title || '', item.info?.author || '');
        if (vibe) vibeCounts[vibe] = (vibeCounts[vibe] || 0) + 1;
    }
    const lastVibe = detectVibe(lastTrack.info?.title || '', lastTrack.info?.author || '');
    const detectedVibe = Object.entries(vibeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || lastVibe || null;
    const vibeData = detectedVibe ? VIBE_CATEGORIES[detectedVibe] : null;

    // ── 3. Parse Last Track Metadata & Artist Cooldown ──
    const lastMeta = parseTrackMetadata(lastTrack.info?.title || '', lastTrack.info?.author || '');
    const cleanLastAuthor = cleanAuthor(lastTrack.info?.author || '').toLowerCase();
    const cleanLastArtist = (lastMeta.primaryArtist || '').toLowerCase();
    const cleanLastComposer = (lastMeta.composer || '').toLowerCase();

    // Collect all artists played in the last 6 tracks
    const recentArtists = new Set();
    const artistPlayCounts = {};

    for (const t of recentHistory) {
        const auth = cleanAuthor(t.info?.author || '').toLowerCase();
        const m = parseTrackMetadata(t.info?.title || '', t.info?.author || '');
        const art = (m.primaryArtist || '').toLowerCase();
        const comp = (m.composer || '').toLowerCase();

        for (const name of [auth, art, comp]) {
            if (name && name.length > 2) {
                recentArtists.add(name);
                artistPlayCounts[name] = (artistPlayCounts[name] || 0) + 1;
            }
        }
    }

    // ── 4. Pick Fresh Peer Artist in Same Language ──
    const artistKey = cleanLastComposer || cleanLastArtist || cleanLastAuthor;
    const knownPeers = PEER_ARTISTS[artistKey] || (targetLanguage && DEFAULT_LANGUAGE_PEERS[targetLanguage]) || [];
    
    // Find peers that haven't been played in recent tracks
    const freshPeers = knownPeers.filter(p => !recentArtists.has(p.toLowerCase()));
    const selectedPeer = freshPeers.length > 0 ? freshPeers[0] : (knownPeers[0] || null);

    // ── 5. Build complementary candidate pools ───────────────────
    // The seed-song pool gets the highest weight; broad vibe/popularity is
    // deliberately weaker. This is closer to YouTube Autoplay than simply
    // selecting the first result from a generic genre search.
    const autoplayQueries = [];

    // Query 1: Vibe Match in Target Language
    const vibeQuery = vibeData && targetLanguage
        ? (vibeData.searchTerms[targetLanguage] || `${targetLanguage} ${detectedVibe} hit songs`)
        : (targetLanguage ? `${targetLanguage} popular songs` : 'popular songs similar to current track');
    autoplayQueries.push({
        query: vibeQuery,
        type: vibeData ? 'VIBE' : 'POPULARITY',
        label: vibeData
            ? `${vibeData.label}${targetLanguage ? ` • ${targetLanguage.toUpperCase()}` : ''}`
            : '🎧 Similar Music',
        weight: vibeData ? 26 : 18,
    });

    // Query 2: Radio / Similar Songs (YouTube Music radio mixes)
    const cleanSongName = lastMeta.songName || cleanSongTitle(lastTrack.info?.title);
    const seedArtist = cleanAuthor(lastTrack.info?.author || '').trim();
    const seedQuery = [`songs similar to "${cleanSongName}"`, seedArtist, targetLanguage]
        .filter(Boolean).join(' ');
    autoplayQueries.push({
        query: seedQuery,
        type: 'RADIO',
        label: `🎧 Related to "${truncate(cleanSongName, 18)}"`,
        weight: 42,
    });

    // Query 3: Fresh Peer Artist with Same Vibe
    if (selectedPeer) {
        autoplayQueries.push({
            query: `${selectedPeer}${targetLanguage ? ` ${targetLanguage}` : ''} hit songs`.trim(),
            type: 'PEER',
            label: `✨ ${truncate(selectedPeer, 18)} • Fresh Artist`,
            weight: 14,
        });
    }

    // ── 6. Select Node & Execute Searches in Parallel ──
    let searchNode = null;
    const allNodes = player.lavalinkManager?.nodeManager?.nodes;
    if (allNodes && allNodes.size > 1) {
        for (const [, n] of allNodes) {
            if (n.connected && (!player.node || n.id !== player.node.id)) {
                searchNode = n;
                break;
            }
        }
    }
    if (!searchNode) {
        searchNode = player.node || (allNodes?.values()?.next()?.value);
    }
    if (!searchNode || !searchNode.connected) return null;

    const searchPromises = autoplayQueries.map(async (q) => {
        try {
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Autoplay search timeout')), 10000)
            );

            const searchExec = (async () => {
                let res = await searchNode.search({ query: q.query, source: 'ytmsearch' }, { username: 'Autoplay', id: 'autoplay' }).catch(() => null);
                if (!res || !res.tracks || res.tracks.length === 0) {
                    res = await searchNode.search({ query: q.query, source: 'ytsearch' }, { username: 'Autoplay', id: 'autoplay' }).catch(() => null);
                }
                return res;
            })();

            const result = await Promise.race([searchExec, timeoutPromise]).catch(() => null);
            return {
                type: q.type,
                label: q.label,
                weight: q.weight,
                tracks: result?.tracks || [],
            };
        } catch {
            return { type: q.type, label: q.label, weight: q.weight, tracks: [] };
        }
    });

    const searchResults = await Promise.allSettled(searchPromises);

    // ── 7. Build Exclusion Sets (Queue + Full History) ──
    const excludedIdentifiers = new Set();
    const excludedTitles = new Set();

    if (player.queue && player.queue.tracks) {
        for (const t of player.queue.tracks) {
            if (t.info?.uri) excludedIdentifiers.add(t.info.uri);
            if (t.info?.identifier) excludedIdentifiers.add(t.info.identifier);
            if (t.info?.title) excludedTitles.add(t.info.title.toLowerCase());
        }
    }

    for (const t of history) {
        if (t.info?.uri) excludedIdentifiers.add(t.info.uri);
        if (t.info?.identifier) excludedIdentifiers.add(t.info.identifier);
        if (t.info?.title) excludedTitles.add(t.info.title.toLowerCase());
    }

    // ── 8. Candidate Evaluation & YouTube-style relevance scoring ──
    const candidateTracks = [];

    for (const settled of searchResults) {
        if (settled.status !== 'fulfilled') continue;
        const { type, label, tracks, weight = 10 } = settled.value;

        for (const track of tracks) {
            if (!track || !track.info) continue;

            const uri = track.info.uri;
            const id = track.info.identifier;
            const title = track.info.title || '';
            const author = track.info.author || '';
            const titleLower = title.toLowerCase();
            const authorLower = cleanAuthor(author).toLowerCase();

            // Skip if already played or queued
            if (excludedIdentifiers.has(uri) || excludedIdentifiers.has(id)) continue;

            // Skip fuzzy duplicates of history
            let isDuplicate = false;
            for (const pastTitle of excludedTitles) {
                if (isFuzzyDuplicate(titleLower, pastTitle)) {
                    isDuplicate = true;
                    break;
                }
            }
            if (isDuplicate) continue;

            // Strict Language Guard: must match target language!
            if (!isLanguageMatch(title, author, targetLanguage)) {
                continue;
            }

            // Duration guard: 60s to 12 minutes
            const duration = track.info.duration || 0;
            if (duration > 0 && (duration < 60000 || duration > 720000)) continue;

            // Parse candidate artist metadata
            const candMeta = parseTrackMetadata(title, author);
            const candArtist = (candMeta.primaryArtist || '').toLowerCase();
            const candComposer = (candMeta.composer || '').toLowerCase();

            // ── YouTube-style relevance score ───────────────────────
            // Each signal is intentionally bounded so one noisy metadata field
            // cannot overpower all other evidence.
            let score = 100 + weight;

            // Search position is a weak relevance signal; never let it dominate.
            const resultRank = tracks.indexOf(track);
            score += Math.max(0, 24 - Math.max(0, resultRank) * 4);

            const candVibe = detectVibe(title, author);
            const seedWords = new Set(cleanSongTitle(lastTrack.info?.title || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3));
            const candidateWords = new Set(cleanSongTitle(title).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3));
            let overlap = 0;
            for (const word of candidateWords) if (seedWords.has(word)) overlap++;
            score += Math.min(24, overlap * 8);

            const sameArtist =
                (cleanLastArtist && (candArtist.includes(cleanLastArtist) || cleanLastArtist.includes(candArtist))) ||
                (cleanLastAuthor && (authorLower.includes(cleanLastAuthor) || cleanLastAuthor.includes(authorLower)));
            const sameComposer = cleanLastComposer && (candComposer.includes(cleanLastComposer) || cleanLastComposer.includes(candComposer));

            if (sameComposer) score += 16;
            if (sameArtist) score += 8;
            if (detectedVibe && candVibe === detectedVibe) score += 30;
            else if (detectedVibe && candVibe) score -= 10;

            if (targetLanguage && detectLanguage(title, author) === targetLanguage) score += 18;

            const candidateDuration = Number(track.info.duration || 0);
            const seedDuration = Number(lastTrack.info?.duration || 0);
            if (seedDuration > 0 && candidateDuration > 0) {
                const durationRatio = Math.abs(candidateDuration - seedDuration) / seedDuration;
                score += Math.max(-8, 12 - Math.round(durationRatio * 20));
            }

            const recentPlays = Math.max(
                artistPlayCounts[candArtist] || 0,
                artistPlayCounts[authorLower] || 0,
                artistPlayCounts[candComposer] || 0
            );
            // One prior play is not enough to reject a highly relevant artist;
            // repeated appearances in the recent window are what trigger cooldown.
            if (recentPlays > 1) score -= recentPlays * 28;
            if (sameArtist && recentPlays > 1) score -= 35;
            else if (sameArtist && recentPlays === 1) score -= 8;

            if (selectedPeer && (authorLower.includes(selectedPeer.toLowerCase()) || candArtist.includes(selectedPeer.toLowerCase()))) {
                score += 28;
            }

            // A search query or shared language alone is not proof of similarity.
            // Keep track of explicit metadata signals so we can describe the pick honestly.
            const relationSignals = {
                titleOverlap: overlap > 0,
                sameArtist: Boolean(sameArtist),
                sameComposer: Boolean(sameComposer),
                sameVibe: Boolean(detectedVibe && candVibe === detectedVibe),
                freshPeer: Boolean(selectedPeer && (authorLower.includes(selectedPeer.toLowerCase()) || candArtist.includes(selectedPeer.toLowerCase()))),
            };
            const hasSimilarityEvidence = relationSignals.titleOverlap ||
                relationSignals.sameArtist || relationSignals.sameComposer || relationSignals.sameVibe;

            // Avoid low-quality variants unless the user explicitly seeded one.
            const qualityPenalties = [
                ['karaoke', -35], ['instrumental', -20], ['cover', -18],
                ['nightcore', -18], ['slowed', -15], ['sped up', -15],
                ['8d', -12], ['remix', -8], ['live', -8]
            ];
            for (const [term, penalty] of qualityPenalties) {
                if (titleLower.includes(term)) score += penalty;
            }
            if (/\\b(official audio|official video|audio song|lyric video)\\b/i.test(title)) score += 5;

            candidateTracks.push({
                track,
                score,
                label,
                hasSimilarityEvidence,
                relationSignals
            });
        }
    }

    if (candidateTracks.length === 0) {
        console.warn(`[Reso] ⚠️ Autoplay: No candidate tracks passed language/history filters for "${targetLanguage}"`);
        return null;
    }

    // Keep exploration controlled: only candidates within 14 points of the
    // strongest result may be selected. This preserves relevance while avoiding
    // a completely deterministic radio sequence.
    candidateTracks.sort((a, b) => b.score - a.score);
    const topScore = candidateTracks[0].score;
    const eligible = candidateTracks.filter(c => c.score >= topScore - 14).slice(0, 4);
    const selected = eligible[Math.floor(Math.random() * eligible.length)];
    const pickedTrack = selected.track;

    // Autoplay is an automatic playback flow, not the manual Recommendations feature.
    // Keep its classification separate from the recommendation cards' category labels.
    pickedTrack.categoryLabel = '🔄 Autoplay Pick';
    pickedTrack.autoplayRelation = selected.relationSignals;
    pickedTrack.isAutoplay = true;
    pickedTrack.isRecommendation = false;

    console.log(`[Reso] 🔄 Autoplay Selected: "${truncate(pickedTrack.info?.title, 40)}" | Score: ${selected.score} | Lang: ${targetLanguage || 'unknown'} | Vibe: ${detectedVibe || 'unknown'} | Relation: ${JSON.stringify(selected.relationSignals)}`);
    return pickedTrack;
}

module.exports = {
    cleanSongTitle,
    cleanAuthor,
    parseTrackMetadata,
    detectLanguage,
    detectVibe,
    detectLanguageAndGenre,
    isLanguageMatch,
    updateSessionState,
    getSessionLanguage,
    getRecommendations,
    getAutoplayTrack,
    isFuzzyDuplicate,
};
