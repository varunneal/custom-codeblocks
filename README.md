# Custom Codeblocks

An Obsidian plugin for custom rendered codeblocks.

## Currently Implemented

### `paper` - Academic Paper References

A card-style codeblock for tracking academic papers and research.

**Usage:**

Use the command palette (`Cmd+P`) → "Insert paper" to insert a template, or manually create:

```
```paper
title: Attention Is All You Need
authors: Vaswani et al.
date: 2017
link: https://arxiv.org/abs/1706.03762
```
```

**Renders as:**

A styled card with:
- Bold title
- Authors and date in muted text
- PDF icon linking to the paper (top right)
- Click anywhere on the card to edit

## Installation

```bash
cd your-vault/.obsidian/plugins/
bun create varunneal/custom-codeblocks
cd custom-codeblocks
bun run build
```

Then reload Obsidian and enable the plugin in Settings → Community plugins.

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release
2. Create a folder called `custom-codeblocks` in your vault's `.obsidian/plugins/` directory
3. Copy the downloaded files into that folder
4. Reload Obsidian and enable the plugin

## Development

```bash
# Install dependencies
bun install

# Build (one-time)
bun run build

# Watch mode (auto-rebuild on changes)
bun run dev
```

## License

0-BSD
