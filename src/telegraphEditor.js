// src/telegraphEditor.js

export const BLOCK_TYPES = {
    P: "p",
    H2: "h2",
    QUOTE: "quote",
    IMAGE: "image",
  };
  
  export function normalizeBlocks(blocks = []) {
    return (Array.isArray(blocks) ? blocks : [])
      .filter(Boolean)
      .map((b) => {
        if (b.type === "image") {
          return {
            type: "image",
            url: String(b.url || ""),
            caption: String(b.caption || ""),
          };
        }
        const type = ["p", "h2", "quote"].includes(b.type) ? b.type : "p";
        return { type, html: String(b.html || "") };
      });
  }
  
  export function createEmptyBlocks() {
    return [{ type: "p", html: "" }];
  }
  
  export function insertBlock(blocks, block, index = null) {
    const next = [...normalizeBlocks(blocks)];
    const safe = block?.type ? block : { type: "p", html: "" };
    if (index === null || index < 0 || index > next.length) next.push(safe);
    else next.splice(index, 0, safe);
    return next;
  }
  
  export function insertImageBlock(blocks, { url, caption = "" }, index = null) {
    return insertBlock(blocks, { type: "image", url, caption }, index);
  }
  
  export function updateBlock(blocks, idx, patch) {
    const next = normalizeBlocks(blocks);
    if (!next[idx]) return next;
    next[idx] = { ...next[idx], ...patch };
    return next;
  }
  
  export function removeBlock(blocks, idx) {
    const next = normalizeBlocks(blocks);
    next.splice(idx, 1);
    return next.length ? next : createEmptyBlocks();
  }
  
  export function buildExcerpt(blocks, maxLen = 160) {
    const text = normalizeBlocks(blocks)
      .filter((b) => b.type !== "image")
      .map((b) => (b.html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
      .join(" ")
      .trim();
    return text.slice(0, maxLen);
  }