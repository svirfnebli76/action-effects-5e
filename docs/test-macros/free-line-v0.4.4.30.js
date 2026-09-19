await (async () => {
  const source = canvas.tokens.controlled[0];
  if (!source) return ui.notifications.warn("Select a source token first.");
  const module = game.modules.get("action-effects-5e");
  const api = module?.api?.crosshairs3d;
  if (!api?.show) return ui.notifications.error("AE5E crosshairs are unavailable.");
  if (module.version !== "0.4.4.30") {
    return ui.notifications.warn("Install AE5E 0.4.4.30 and reload Foundry first.");
  }
  try {
    const result = await api.show({
      source,
      shape: { type: "free-line", length: 60, width: 5, height: 20, yaw: 0 },
      range: { max: 120, policy: "endpoints", showBoundary: true },
      controls: { rotationStep: 5, lengthStep: 5, minLength: 5, elevationStep: 5 },
      capabilities: { rotation: true, resize: true, elevation: true },
      visual: { tracer: false }
    });
    ui.notifications.info(result.cancelled ? "Line test cancelled." :
      `Line confirmed: ${result.shape.length} ft long, base elevation ${result.placementPoint.z} ft.`);
  } catch (error) {
    console.error("AE5E free-line test", error);
    ui.notifications.error(error.message);
  }
})();
