# Releasing @magmablock/plugin-ctl

This project uses manual npm publishing.

## 1) Pre-release checklist

```bash
npm whoami
npm pack --dry-run
npm run typecheck
npm test
npm run build
```

## 2) Stable release (`latest`)

```bash
npm version patch
npm publish --tag latest --access public
```

## 3) Pre-release (`next`)

```bash
npm version prerelease --preid next
npm publish --tag next --access public
```

## 4) Post-release verification

```bash
npm view @magmablock/plugin-ctl dist-tags --json
npm i -g @magmablock/plugin-ctl@latest
plugin-ctl --version
plugin-ctl self update-check
```
