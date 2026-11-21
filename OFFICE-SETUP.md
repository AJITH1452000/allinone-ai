# Evolvix — Office setup (for IT)

Evolvix is a chat and coding assistant that runs **entirely on one office PC**. The AI model runs locally through Ollama. In office mode, company code and chats stay on this machine, nothing is sent to the internet, and nobody can use the app without the owner's approval.

## 1. What runs where

| Part | Runs on | Port | Talks to |
|---|---|---|---|
| Evolvix server (Node.js, `server.js`) | the office PC | 3001 (HTTPS if configured) | Ollama on `localhost:11434` only |
| Ollama (AI models) | the same PC | 11434, localhost only | nothing (auto-update off, see §7) |
| Browser UI | users' PCs on the office LAN | — | the Evolvix server only |

### Why nothing leaves the network (four independent layers)

1. **Windows Firewall lock** (`firewall-lock.ps1`): outbound blocked for every `node.exe` and `ollama.exe` except loopback and the office subnet. Inbound on the Evolvix port is allowed only from the office subnet.
2. **Outgoing-network guard in the app**: in office mode, every `fetch` / `http` / `https` call from the server is checked against an allowlist: `localhost`, `127.0.0.1`, the Ollama host and `OFFICE_ALLOWED_HOSTS`.
   - Anything else is blocked and written to the audit log.
   - Settings → Admin → *Outgoing connections* lists every host contacted since start.
3. **Cloud AI and web search are switched off on the server**, not just hidden in the UI. Requests to them are rejected.
4. **The code runner sandbox has no network.**

At start the server tests whether `https://example.com` is reachable. If it is, the firewall lock is off: the server prints a red warning and the owner sees it in the app.

## 2. Install

Install Node.js LTS, Ollama and Git, then in `C:\Evolvix`:

```powershell
npm ci                       # never "npm install" in the office: npm ci installs exactly package-lock.json
npm rebuild esbuild --ignore-scripts=false
npm run vendor               # one-time: the preview's scripts (React, MUI, Babel…) into public\vendor
npm run build
copy .env.example .env       # then edit: OFFICE_MODE=1 and the settings below
cleanup.cmd                  # Ollama speed settings + Learn models
npm run load-docs            # optional: React/MUI/Vite docs for better code answers
```

Minimal `.env` for a team:

```
OFFICE_MODE=1
HOST=0.0.0.0
OFFICE_ALLOWED_IPS=192.168.1.0/24
HTTPS_CERT=C:\Evolvix\certs\evolvix.pem
HTTPS_KEY=C:\Evolvix\certs\evolvix-key.pem
```

Then start the server and lock the firewall:

```powershell
npm run start:office         # Node permission model, see §4
firewall-lock.ps1            # as Administrator
```

The first time someone opens the app, it shows the **one-time owner setup**: a username, a password of at least 12 characters, and an authenticator app (QR code plus 8 recovery codes). After that the setup page is disabled permanently.

**Refusals at start.** The server will not start in office mode in two cases:
- on Vercel;
- when the project, `.env`, `keys.json` or `data\` is inside OneDrive, Google Drive or Dropbox. Use a local folder such as `C:\Evolvix`.

## 3. HTTPS on the LAN (mkcert, free)

```powershell
winget install FiloSottile.mkcert
mkcert -install                                   # local CA on this PC
mkdir C:\Evolvix\certs; cd C:\Evolvix\certs
mkcert -cert-file evolvix.pem -key-file evolvix-key.pem evolvix.local 192.168.1.50 localhost
```

Install the mkcert root CA (`mkcert -CAROOT` shows where it is) on users' PCs via Group Policy so browsers trust it.

`HOST=0.0.0.0` without HTTPS prints a large warning, because passwords would cross the LAN unencrypted.

## 4. Run as a Windows service (NSSM) under a dedicated account

1. Create a local user `svc-evolvix` with no admin rights. Give it Modify on `C:\Evolvix\data` and Read on `C:\Evolvix`.
2. Install the service:

   ```powershell
   nssm install Evolvix "C:\Program Files\nodejs\node.exe" --permission --allow-fs-read=C:\Evolvix --allow-fs-read=%TEMP% --allow-fs-write=C:\Evolvix\data --allow-fs-write=%TEMP% --allow-child-process server.js
   nssm set Evolvix AppDirectory C:\Evolvix
   nssm set Evolvix ObjectName .\svc-evolvix <password>
   nssm start Evolvix
   ```

**Node permission model.** The server may read only the project and temp folders, and write only `data\` and temp. A read of `C:\Windows\win.ini` from the server fails with `ERR_ACCESS_DENIED`.

`--allow-child-process` is needed for three things:
- the Vite build check that verifies generated projects;
- the code runner, which spawns its own locked-down Node sandbox;
- the PowerShell helper that unlocks the encryption key with DPAPI.

**Encryption key.** The master key is protected with Windows DPAPI for the account that runs the service. Create it by running the server once as `svc-evolvix`. If DPAPI is unavailable, set `OFFICE_MASTER_PASSWORD` (it is then required at every start).

## 5. Firewall rule example (office subnet only)

`firewall-lock.ps1` creates these rules in the group **Evolvix-Lock**:
- outbound block for each `node.exe` (PATH, nvm, Program Files) and `ollama.exe` / `ollama app.exe`, to every address outside `OFFICE_ALLOWED_IPS`;
- inbound allow for TCP 3001 from the subnet, and inbound block from everywhere else.

| Task | Command (as Administrator) |
|---|---|
| Check | `status.ps1` |
| Allow updates | `firewall-unlock.ps1` (outbound open for 30 min, then re-locks automatically) |
| Install packages | `npm run secure-install`: unlock → `npm ci` → audit → lockfile-lint → deps report → lock |

Check that the lock works:

```powershell
node -e "fetch('https://example.com').then(()=>console.log('OPEN')).catch(()=>console.log('BLOCKED'))"   # → BLOCKED
```

## 6. Access approval (how people get in)

- By default **only the owner** can log in. The owner needs a password and a 6-digit authenticator code.
- Everyone else clicks **Request access** (rate limited to 3 per IP per hour). The owner reviews requests in Settings → Access and chooses:
  - **permissions**: chat, upload files, knowledge bases, run code, projects/build agent, export (default: chat only);
  - **models**: default `learn` only;
  - **expiry**: 1, 7 or 30 days, or a custom date. There is no "forever".
- Approval creates a **one-time invite link** (valid 24 h, single use). The person sets their own password; the owner never sees it.
- Expired users are blocked automatically and can request a renewal.
- Anything outside a user's permissions returns 403 with an **Ask the owner** button.
- The owner can, at any time, suspend a user, change permissions, force a logout, or delete a user (optionally with their data).
- **Lock app** (Settings → Access) logs out everyone except the owner immediately.
- **Sessions:** idle timeout 30 min, absolute timeout 12 h. Cookies are HttpOnly and SameSite=Strict, plus Secure on HTTPS. Every change needs a CSRF token.
- **Wrong passwords:** after 5, the account is locked for 15 minutes, the IP is slowed down and the owner gets a notice.

## 7. Models and updates

- Turn **off Ollama auto-update** in Ollama's settings. Update only like this: `firewall-unlock.ps1` → `ollama pull …` → `firewall-lock.ps1`.
- Only `.gguf` / `.safetensors` model files are accepted. Pickle formats (`.bin .pt .pth .pkl .ckpt`) are refused because loading them can run code.
- Imported models are hashed (SHA-256) into `models\hashes.json`. Every office start re-checks them and warns if one changed.
- npm hygiene:
  - `.npmrc` sets `ignore-scripts=true`, `save-exact=true` and `audit-level=high`.
  - Every dependency is pinned to an exact version.
  - `npm run deps-report` lists each package with its licence and install scripts, and flags packages that are new since the last report.
  - A pre-commit hook blocks `.env*`, `keys.json`, `data\`, `*.gguf`, private keys and `api_key=` values.

## 8. Data protection, backup and restore

- **Encryption at rest:** everything under `data\` is encrypted with AES-256-GCM: users, sessions, chats, knowledge bases, usage, training data and the audit log.
- **Per-user data:** each user's chats, settings and knowledge bases live in `data\users\<id>\`. A user can only read their own folder. The owner sees sizes, not contents.
- **Uploads:** only the extracted text of uploaded files is stored, encrypted, in that user's knowledge base.
- **Training data:** off by default. It is saved only if the owner enables it **and** the user agreed. It is stored separately in `data\training\office\`.
- **Backup:** `npm run backup` writes one encrypted `backups\evolvix-backup-<date>.zip.enc`; the password is asked at run time. `npm run restore -- <file>` restores it on any machine.
- **Audit log** (`data\audit.log`, owner: Settings → Audit) records:
  - logins, failed logins, access requests and approvals;
  - expiry, permission changes and admin actions;
  - blocked network attempts, exports, backups and lock/unlock.

  It never records message contents or passwords. Every line is encrypted and chained with a SHA-256 hash of the previous one, so **Verify log integrity** detects any edited, removed or reordered line.

## 9. Hardware guide

| GPU VRAM | Users | Models |
|---|---|---|
| 4 GB (e.g. RTX 3050) | 1 user at a time | `learn` (Qwen3 4B); `learn-max` (8B) is slow |
| 12 GB | small team (3–5) | 4B and 8B models comfortably |
| 24 GB | team (10+) | up to 14B models |

Requests are queued: one generation at a time per model, with the owner first. Users see "In queue (2 ahead)". Each user is limited to 30 requests per minute.

## 10. Editor and browser on the office PC

- Use a **separate browser profile with no extensions** for Evolvix.
- In VS Code, use only trusted extensions and set `"telemetry.telemetryLevel": "off"`.

## 11. Licences

| Component | Licence |
|---|---|
| Qwen3 (learn, learn-max) | Apache-2.0 |
| Gemma 3 (learn-vision) | Gemma Terms of Use |
| Ollama | MIT |
| MUI, Recharts, React, Vite | MIT |
| Self-hosted fonts (@fontsource: Inter, Source Serif 4, Noto Sans Tamil) | SIL OFL 1.1 |
| All npm dependencies | listed by `npm run deps-report` |

## 12. Company data

Company code and chats stay on this machine. IT can inspect the machine and the audit log under company policy. Users should be told that the owner and IT administer this system. The app does not show users' chat contents to the owner unless a user shares a chat.
