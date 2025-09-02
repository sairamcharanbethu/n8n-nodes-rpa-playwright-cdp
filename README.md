![Banner image](https://user-images.githubusercontent.com/10284570/173569848-c624317f-42b1-45a6-ab09-f0ea3c247648.png)

# n8n-nodes-rpa-playwright-cdp

Custom **RPA browser automation nodes** for [n8n](https://n8n.io): persistent browser sessions and workflow control via Playwright, CDP, and Selenium Grid.  
Built for advanced, robust, and maintainable automation!

---

## 🚀 Features

- **Launch Browser:** Spin up persistent Chrome with Selenium & Playwright, share session object
- **Navigate:** Navigate to URLs using an existing session (CDP)
- **Close Browser:** Gracefully terminate the remote or local session
- Built for _modular, production-ready RPA_
- Every parameter is configurable (CDP URL, user profile, headless, browser args, etc.)
- Built in TypeScript, strict linter, icon support  
- Session data flows between nodes for full-state automation!

---

## Prerequisites

- [git](https://git-scm.com/downloads)
- Node.js v20+ and npm (install with [nvm](https://github.com/nvm-sh/nvm) or [official instructions](https://nodejs.org/))
- [n8n](https://n8n.io) self-hosted (local, cloud VM, or Docker)
- (Optional) [Selenium Grid](https://www.selenium.dev/documentation/grid/) for persistent remote Chrome sessions
- Docker (if running n8n in containers)

---

## Installation and Build


> Optionally: place your SVG icon(s) in `nodes/browser/` and reference them from your node’s `icon:` property.

---

## Usage with n8n (Self-Hosted)

- **Mount your built code** (not node_modules/ or .cache) as a Docker volume for the n8n container, or copy to your n8n server machine.
- Set the environment variable so n8n knows where to find your custom nodes:

Or, configure it in your Docker Compose/Run settings.

- **Restart n8n**, then head to the n8n Editor UI and search for your nodes:
- **Launch Browser**
- **Navigate**
- **Close Browser**

---

## Example Workflow

1. **Launch Browser**: Create a browser session, return session info
2. **Navigate**: Go to desired URLs, retaining session/cookies/context
3. (Future steps: click, scrape, fill, etc. with more nodes)
4. **Close Browser**: End session and clean up

---

## Development & Contribution

- **Lint:** `npm run lint`
- **Fix:** `npm run lintfix`
- **Format:** `npm run prettier`
- Fork, branch, commit, and PR for improvements or bugfixes!
- See n8n’s [node development docs](https://docs.n8n.io/integrations/creating-nodes/build/node-development-environment/) for more.

---

## License

[MIT](./LICENSE.md)
