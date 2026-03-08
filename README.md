# OpenDrop

A free, secure, and open-source file sharing tool. Transfer files across your local network directly from device to device using WebRTC, or upload and share via link.

## How to Use

1. **Same Network Transfer** — Open OpenDrop on two devices connected to the same Wi-Fi. They auto-discover each other. Click a peer to send a file directly (peer-to-peer, no server involved).
2. **Share via Link** — Click **"Share via Link"** to upload a file and get a shareable download link (expires in 24 hours). Send the link to anyone.

## How it works

OpenDrop relies on two parts:
1. **The Client (Frontend):** A static HTML/CSS/JS site hosted on GitHub Pages. It manages the UI and the Peer-to-Peer WebRTC connection.
2. **The Server (Backend):** A lightweight Node.js WebSocket signaling server. It matches devices that have the same public IP address (i.e. on the same Wi-Fi) and introduces them so they can connect directly. It also handles file uploads for shareable links.

For local transfers, your files *never* touch the signaling server. They are sent entirely Peer-to-Peer over your local network using secure WebRTC Data Channels.

## Hosting for Free

### 1. The Frontend (GitHub Pages)
This repository includes a GitHub Action to automatically deploy the `client` folder to GitHub Pages.
1. Go to your repository settings on GitHub.
2. Navigate to **Pages** on the left menu.
3. Under Build and deployment, choose **GitHub Actions** as the source.
4. The site will automatically deploy whenever you push to `main`.

### 2. The Backend (Signaling Server)
You can deploy the backend for free using [Koyeb](https://www.koyeb.com/) or [Render](https://render.com/).
1. Log into Koyeb or Render and select "New Web Service".
2. Connect your GitHub repository.
3. Use the following build settings:
   - Root Directory: `server`
   - Build Command: `npm install`
   - Start Command: `node index.js`
4. Once deployed, take the URL (e.g. `wss://your-app-name.koyeb.app`) and replace the `SIGNALING_URL` variable inside `/client/main.js`. Then push to `main` to update the frontend.

## Local Development
Since the frontend uses ES Modules natively, no complex build tools are required.

Start the signaling server:
```bash
cd server
npm install
node index.js
```

Serve the frontend (Requires Python):
```bash
cd client
python3 -m http.server 8080
```
Then navigate to `http://localhost:8080` in your web browser.
