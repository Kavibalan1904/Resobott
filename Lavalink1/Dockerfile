FROM fredboat/lavalink:4.2.2

# Set default port (overridden dynamically by Render/Koyeb via $PORT)
ENV PORT=8080
EXPOSE 8080

COPY application.yml /opt/Lavalink/application.yml

WORKDIR /opt/Lavalink

# Optimized JVM flags for low memory footprint (512MB cloud containers like Render / Koyeb):
# -Xmx384m: Caps heap at 384MB, leaving ~128MB for OS, native threads, and Metaspace
# -XX:+UseG1GC: Low-latency garbage collection specifically designed for real-time audio streams
# -XX:MaxGCPauseMillis=20: Keeps GC pauses under 20ms to prevent audio buffer underruns
# -XX:+ExitOnOutOfMemoryError: Restarts cleanly if memory is exhausted
ENTRYPOINT ["java", \
    "-Xmx256m", \
    "-Xms96m", \
    "-XX:+UseG1GC", \
    "-XX:MaxGCPauseMillis=20", \
    "-XX:+ExitOnOutOfMemoryError", \
    "-Djdk.tls.client.protocols=TLSv1.2,TLSv1.3", \
    "-jar", "Lavalink.jar"]
