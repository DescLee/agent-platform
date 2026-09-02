// Productized connectors shown on the Connectors page and in session Sources.
// Connected connectors are always shown separately; this set controls the
// curated not-yet-connected catalog shared by both surfaces.
export const AVAILABLE_CONNECTOR_NAMES = new Set([
  "figma",
  "dingtalk",
  "feishu",
  "wecom",
  "tencent_docs",
]);

export const CLI_CONNECTOR_NAMES = new Set(["dingtalk", "feishu", "wecom"]);
