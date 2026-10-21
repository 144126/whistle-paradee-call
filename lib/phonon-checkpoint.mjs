// The Phonon checkpoint the Phonon page loads, pinned to one commit, file by file, with each file's
// exact size. Shared by the page and server.mjs: the page builds its ModelSpec and resumable
// download from it, and the server checks a local copy against it before offering to serve one.
// Bumping the commit means updating every size here too; a size that does not match is never used.
export const CHECKPOINT = {
  repo: "gradium/phonon-31m-en",
  commit: "8c64b55ec301728e2d1695bfea87a08a267d0c2d",
  files: {
    "config.json": 2851,
    "tokenizer.json": 277967,
    "default-voice.safetensors": 256136,
    "model.q8.gguf": 64512352,
  },
};
