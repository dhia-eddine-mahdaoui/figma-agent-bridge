# Figma bridge and design work

Keep designs editable and the Layers panel understandable.

- Minimize nodes before writing, not just group them afterward. Use parent fills for backgrounds and native strokes or a decorative background fill for dividers. Avoid separate background rectangles and divider layers when the parent can represent them.
- Use a single image node per image; remove wrappers that exist only for clipping or corners by putting the required alpha mask into the image asset. Keep each icon and its border in one shape using its image fill and stroke.
- Avoid one-use groups containing only a paragraph's two columns. Put the two full text nodes directly in the section. Only add containers with an actual layout, interaction, or reuse purpose.

- Use one native TEXT node for each paragraph. A two-column paragraph may use exactly two TEXT nodes, one per column. Never split paragraph text into word, glyph, or line layers to approximate browser geometry.
- Preserve natural text wrapping. Prefer font, width, line-height, alignment and paragraph adjustments. Explain a rendering difference if exact matching would require fragmented text.
- Group complete newsletter sections and cards into clearly named frames. Use components only for intentional reusable components; never create components for one-off paragraphs or decorative pieces.
- Before a write, inspect the destination. After a timeout, inspect saved nodes before retrying. Never claim the user closed the plugin without evidence.
- Keep a heartbeat alive independently of command execution. A stale session may be replaced while recording any interrupted write as uncertain. Do not block reconnection forever on an orphan command.
- Do not modify or reload plugin source during a live canvas mutation. Finish bridge changes and tests first, then reload once, inspect, and mutate the design.
