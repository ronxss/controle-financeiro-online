# ---- 1) Front-end (React/Vite) ----
FROM node:26-alpine AS front
WORKDIR /src/ClientApp
COPY ClientApp/package*.json ./
# Com package-lock.json versionado o build é reprodutível (npm ci); sem ele, cai no npm install.
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
COPY ClientApp/ ./
RUN npm run build            # gera /src/wwwroot (outDir ../wwwroot)

# ---- 2) Back-end (.NET) ----
FROM mcr.microsoft.com/dotnet/sdk:11.0 AS build
WORKDIR /src
COPY ControleFinanceiro.csproj ./
RUN dotnet restore
COPY . .
COPY --from=front /src/wwwroot ./wwwroot
RUN dotnet publish -c Release -o /app -p:SkipClientBuild=true --no-restore

# ---- 3) Imagem final (enxuta, sem root) ----
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app
COPY --from=build /app .

# Chaves do cookie de login: monte um volume em /keys para não deslogar todos a cada deploy.
RUN mkdir -p /keys && chown app /keys
ENV ASPNETCORE_URLS=http://+:8080 \
    ASPNETCORE_FORWARDEDHEADERS_ENABLED=true \
    DataProtection__Path=/keys
USER app
EXPOSE 8080
ENTRYPOINT ["dotnet", "ControleFinanceiro.dll"]
