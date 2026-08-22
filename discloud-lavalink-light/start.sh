#!/bin/bash
if [ ! -f Lavalink.jar ]; then
  echo "Downloading Lavalink.jar v4.2.2..."
  curl -L -s -o Lavalink.jar https://github.com/lavalink-devs/Lavalink/releases/download/4.2.2/Lavalink.jar
fi
echo "Starting Lavalink server..."
java -Djdk.tls.client.protocols=TLSv1.2,TLSv1.3 -jar Lavalink.jar
