# Installing the remote server on Debian

Step by step, on a fresh Debian 12 or 13 machine (amd64 or arm64), for the remote server described in
[server.md](server.md). Read its "What protects what" section first: the server holds your edu-ID credentials.

You need:

- a machine with about 8 GB of RAM and 15 GB of free disk (estimate), reachable on ports 80 and 443;
- a domain name whose DNS record points to it, e.g. `heig.example.org`;
- an SSH access with `sudo`.

The `server` and `render` images are built by GitHub Actions and downloaded from GitHub Container Registry
(`ghcr.io/cyprien-png/heig-kit-server` and `heig-kit-render`): nothing heavy is built on the machine. The repository is
still cloned, for the Compose file, `.env` and the commands run on the machine itself (indexing, first login).

## 1. System packages

```sh
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y ca-certificates curl git gnupg ufw
```

Firewall: SSH and HTTPS only. Every HEIG-Kit port is bound to `127.0.0.1`, so Docker does not open anything.

```sh
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw enable
```

## 2. Docker

From Docker's own repository (the `docker.io` package of Debian lacks a recent Compose):

```sh
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update && sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

## 3. Node.js 22

Used on the machine for the first login, indexing (`npm run ingest`) and updates:

```sh
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs
node --version    # v22.x
```

## 4. The account running HEIG-Kit

The containers run as uid **1000** and share `data/` and `.cache/` with the commands you run on the machine, so use
the account with uid 1000. On many VPS it already exists (`debian`, `admin`): check with `id -u`. Otherwise create it:

```sh
getent passwd 1000 || sudo adduser --uid 1000 --disabled-password --gecos "" heig
sudo usermod -aG docker "$(getent passwd 1000 | cut -d: -f1)"
```

Being in the `docker` group is equivalent to being root: keep this account for HEIG-Kit. Log in again as this account
(`sudo -iu <name>`) for the group to apply, then check `docker ps`.

## 5. HEIG-Kit and its settings

```sh
git clone https://github.com/Cyprien-png/HEIG-Kit.git ~/HEIG-Kit && cd ~/HEIG-Kit
npm ci
cp .env.example .env && chmod 600 .env
openssl rand -hex 32    # for HEIG_JWT_SECRET
nano .env
```

In `.env`, fill your edu-ID credentials (`HEIG_EMAIL`, `HEIG_PASSWORD`) and uncomment the "Remote server" section:

```sh
HEIG_AUTH_USERNAME=me
HEIG_AUTH_PASSWORD=a-long-password-of-yours     # 12 characters at least, not your edu-ID password
HEIG_JWT_SECRET=<output of openssl rand -hex 32>
HEIG_PUBLIC_URL=https://heig.example.org
HEIG_TRUST_PROXY=1
```

## 6. Check that GAPS and edu-ID accept the machine

Before anything else: some hosting providers' addresses are refused, and then nothing else works.

```sh
npm run schedule
```

The first login usually asks for the two-step code of your authenticator app:
`npm run schedule -- --mfa-code 123456`. The session is then saved in `.cache/` for a few weeks.

## 7. Start

```sh
npm run rag:start       # database and embedding model
npm run ingest          # indexes your courses: shows progress and the time left; the first run is long
npm run server:start    # downloads the server and render images, then starts them
curl -s http://127.0.0.1:8766/health    # ok
```

The `server` image also holds the web application ([app.md](app.md)); once HTTPS is set up (next step), open
`https://heig.example.org` and log in with `HEIG_AUTH_USERNAME` / `HEIG_AUTH_PASSWORD`.

## 8. HTTPS with Caddy

Caddy gets and renews the certificate by itself. From its repository:

```sh
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

`/etc/caddy/Caddyfile`, replacing its content:

```
heig.example.org {
  reverse_proxy 127.0.0.1:8766
}
```

```sh
sudo systemctl reload caddy
curl -s https://heig.example.org/health    # ok, from your own computer
```

Then connect a client as explained in [server.md](server.md#connect-a-client).

## 9. Keep the knowledge base up to date

`npm run autoupdate` installs a daily indexing (a systemd user timer). On a server, let it run without an open
session:

```sh
sudo loginctl enable-linger "$USER"
npm run autoupdate
```

Its log is `data/logs/update.log`. When edu-ID asks for a two-step code again, the update fails until you run
`npm run rag:update` by hand once.

## 10. Updating

Every push to `main` publishes new images (`.github/workflows/server-images.yml`). On the machine:

```sh
cd ~/HEIG-Kit && npm run server:update
```

It pulls the repository, reinstalls the dependencies, downloads the new images and restarts the containers. A video
being rendered at that moment is lost: render it again.

Other versions, with `HEIG_IMAGE_TAG` in the command (the repository stays on its branch: switch it with `git checkout`
to match):

| `HEIG_IMAGE_TAG` | Images |
|---|---|
| `latest` (default) | Last commit of `main` |
| `develop` | Last commit of `develop` |
| `1.2.3` | Release tag `v1.2.3` |
| `sha-1a2b3c4` | One given commit, e.g. to go back after a bad update |

```sh
HEIG_IMAGE_TAG=sha-1a2b3c4 npm run server:update
```

`npm run server:build` builds the images on the machine instead (long: about half an hour for `render`).

## Troubleshooting

| | |
|---|---|
| `docker compose -f rag/compose.yml --profile server logs server` | Server log (logins, errors) |
| `docker compose -f rag/compose.yml --profile server ps` | State of the containers |
| `denied` when downloading the images | The GHCR packages are private: make them public in GitHub (Packages, Package settings), or `docker login ghcr.io` with a token allowed to `read:packages` |
| The server does not start | Its log names the missing or weak setting of `.env` |
| `EACCES` on `data/` or `.cache/` | They are not owned by uid 1000: `sudo chown -R 1000:1000 data .cache` |
| 421 `unknown host` | `HEIG_PUBLIC_URL` does not match the address used by the client |

## Backups

`.env`, `data/` (course documents, tokens, job records) and `.cache/` (login session) in the repository folder, and the
Docker volumes `heig-kit_outputs` (generated documents and videos) and `heig-kit_db` (the index, which `npm run ingest`
can rebuild).
