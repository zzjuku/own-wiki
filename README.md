# Own WIKI

A local desktop wiki program for fictional stories (macOS + Windows). Each project is a self-contained folder of plain files.

See [SPEC.md](SPEC.md) for the design and decision log.

## Development

Needs Node.js and Rust.

```bash
npm install
npm test                          # frontend + Rust tests
npm run test:ui                   # UI tests (Playwright; once: npx playwright install chromium)
npm run tauri dev                 # run the app with live reload
npx tauri build --bundles app     # build the Mac app (src-tauri/target/release/bundle/macos/)
```

The Windows installer is built by GitHub Actions on every push to `main` (Actions tab → latest "Windows build" run → Artifacts).
