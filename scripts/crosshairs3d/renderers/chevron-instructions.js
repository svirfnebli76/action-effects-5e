export function createInstructionPanel(parent, origin, tokenHeight, showImmunity) {
    const root = new PIXI.Container();
    root.name = "ae5e-withdraw-movement-instructions";
    root.eventMode = "none";
    const background = new PIXI.Graphics();
    root.addChild(background);
    const rows = [], labels = [];
    const row = parts => {
      const container = new PIXI.Container();
      root.addChild(container);
      let width = 0, height = 0;
      for (const [text, bold = false, italic = false] of parts) {
        const label = new PIXI.Text(text, new PIXI.TextStyle({
          fontFamily: "Arial", fontSize: 20,
          fontWeight: bold ? "bold" : "normal",
          fontStyle: italic ? "italic" : "normal",
          fill: 0xFFFFFF, padding: 3
        }));
        label.resolution = 2;
        label.roundPixels = true;
        label.anchor.set(0, 0.5);
        label.position.set(width, 0);
        label.eventMode = "none";
        container.addChild(label);
        labels.push(label);
        width += label.width;
        height = Math.max(height, label.height);
      }
      rows.push({ container, width, height });
    };
    row([["Press "], ["Control + Left Click", true], [" to set a Waypoint"]]);
    if (showImmunity) row([["This movement is "], ["IMMUNE", true, true],
      [" from opportunity attacks"]]);
    const paddingX = 12, paddingY = 8, lineGap = 4;
    const tokenGap = canvas.grid.size * 1.5;
    const width = Math.max(...rows.map(row => row.width)) + paddingX * 2;
    const height = rows.reduce((sum, row) => sum + row.height, 0) +
      (rows.length - 1) * lineGap + paddingY * 2;
    let y = paddingY;
    for (const row of rows) {
      row.container.position.set((width - row.width) / 2, y + row.height / 2);
      y += row.height + lineGap;
    }
    background.beginFill(0x202020, 0.80).drawRoundedRect(0, 0, width, height, 4).endFill();
    let above = false, destroyed = false;
    const positionPanel = () => root.position.set(origin.x - width / 2,
      above ? origin.y - tokenHeight / 2 - tokenGap - height
        : origin.y + tokenHeight / 2 + tokenGap);
    const updateResolution = () => {
      const zoom = Math.max(Math.abs(canvas.stage.scale.x), Math.abs(canvas.stage.scale.y));
      const resolution = Math.min(8, Math.max(2,
        Math.ceil(zoom * (canvas.app.renderer.resolution || 1) * 1.5)));
      for (const label of labels) if (label.resolution !== resolution) label.resolution = resolution;
    };
    positionPanel();
    updateResolution();
    parent.addChild(root);
    return {
      frame: updateResolution,
      update(cursor) {
        if (destroyed || !Number.isFinite(cursor?.y)) return;
        // At the source's exact Y, retain the previous side to avoid flicker.
        const nextAbove = cursor.y === origin.y ? above : cursor.y > origin.y;
        if (nextAbove !== above) {
          above = nextAbove;
          positionPanel();
        }
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        root.parent?.removeChild(root);
        root.destroy({ children: true, texture: true, baseTexture: true });
      }
    };
  }

