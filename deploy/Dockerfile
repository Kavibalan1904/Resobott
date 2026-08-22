FROM fredboat/lavalink:4.2.2

# Expose standard port
EXPOSE 7860

# Copy application configuration
COPY application.yml /opt/Lavalink/application.yml

WORKDIR /opt/Lavalink
ENTRYPOINT ["java", "-Djdk.tls.client.protocols=TLSv1.2,TLSv1.3", "-jar", "Lavalink.jar"]
