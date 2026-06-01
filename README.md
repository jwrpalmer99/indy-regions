# Indy Regions

Indy Regions is a Foundry VTT module for painting and editing Region shapes on the canvas. It adds a **Paint Region** tool to the Region controls so GMs can create new Regions or edit a selected Region by painting directly on the scene using additive/subtractive painting and flood fills.

## Compatibility

- Foundry VTT v13 minimum
- Verified for Foundry VTT v14
- GM-only painting workflow

## Features

- Paint new Region shapes directly on the canvas
- Edit an existing selected Region
- Add or subtract painted areas
- Undo and redo paint operations
- Ctrl-wheel brush resizing
- HSL-based flood fill with tolerance and hue/lightness bias controls
- Alt-click fill from an existing Region shape
- Shift-Alt-click erase from an existing Region shape
- Smoothing and shrink/grow controls for final Region boundaries
- Localized UI strings for common languages

## Basic Usage

1. Enable **Indy Regions** in your world.
2. Open the **Region** scene controls.
3. Click **Paint Region**.
4. Paint on the canvas.
5. Click **Create Region** to create a new Region.

To edit an existing Region, select exactly one Region first, then click **Paint Region**. The dialog button changes to **Update Region**, and saving updates that Region's shapes.

## Paint Controls

| Input | Action |
| --- | --- |
| Left-drag | Add painted area |
| Shift-left-drag | Subtract painted area |
| Ctrl-click | HSL flood fill from the clicked color |
| Ctrl-Shift-click | HSL flood erase from the clicked color |
| Alt-click | Fill the clicked source Region shape |
| Shift-Alt-click | Erase the clicked source Region shape |
| Ctrl-mouse wheel | Change brush size |

## Dialog Settings

| Setting | Description |
| --- | --- |
| Pen Colour | Color used for the live paint preview and newly created Region color |
| Paint Opacity | Opacity of the live paint preview |
| Brush Size | Brush diameter in pixels |
| Fill Tolerance | How broadly flood fill accepts similar colors |
| HSL Fill Bias | Bias flood fill matching toward lightness or hue |
| Fill Bridge | Allows flood fill to cross small gaps |
| Grid Step | Mask resolution; lower is more precise, higher is faster |
| Shrink / Grow | Contracts or expands the final boundary |
| Border Smooth | Simplifies jagged final boundaries |
| Border Thickness | Controls live preview border thickness; `0` disables live border calculation |

Most paint dialog settings are remembered for the next editor session.

## Module Settings

| Setting | Description |
| --- | --- |
| Debug Region Paint Timings | Logs timing details for mask rebuilds, previews, and commits |
| Show Region Paint Help | Shows or hides the help section in the Paint Region dialog |

## Notes

- Region opacity is not set automatically on created Regions. Use Foundry's built-in Region configuration UI if you want to adjust the saved Region opacity.
- When editing an existing Region, Indy Regions hides the original Region during painting and restores it when the session ends.
- If the target Region has an Indy FX shader behavior, Indy Regions temporarily suppresses that shader while editing.

## Development

Install dependencies:

```bash
npm install
```

Create local Foundry symlinks from `foundry-config.yaml`:

```bash
npm run createSymlinks
```

The module entry point is:

```text
scripts/main.js
```

The paint dialog template is:

```text
templates/region-paint-dialog.html
```

## License

See [license.md](license.md).
