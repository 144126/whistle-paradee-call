export async function models(signal) {
  const response = await fetch("https://openrouter.ai/api/v1/models?output_modalities=transcription", { signal });
  if (!response.ok) throw new Error(`could not load transcription models (${response.status})`);
  return (await response.json()).data.filter((model) => model.architecture?.output_modalities?.includes("transcription"));
}

export function wav(audio) {
  const buffer = new ArrayBuffer(44 + audio.length * 2);
  const view = new DataView(buffer);
  const text = (at, value) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); text(8, "WAVEfmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data");
  view.setUint32(40, audio.length * 2, true);
  audio.forEach((sample, i) => view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767)), true));
  return new Uint8Array(buffer);
}

export async function transcribe(audio, { model, key }) {
  if (!model) throw new Error("select an OpenRouter transcription model in settings");
  let binary = "";
  for (const byte of wav(audio)) binary += String.fromCharCode(byte);
  const response = await fetch(key ? "https://openrouter.ai/api/v1/audio/transcriptions" : "/api/transcribe", {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: { "Content-Type": "application/json", ...(key && { Authorization: `Bearer ${key}` }) },
    body: JSON.stringify({ model, input_audio: { data: btoa(binary), format: "wav" } }),
  });
  if (!response.ok) throw new Error(`transcription failed (${response.status}): ${(await response.text()).slice(0, 180)}`);
  const result = await response.json();
  if (typeof result.text !== "string") throw new Error(result.error?.message || "no transcript returned");
  return result.text;
}
