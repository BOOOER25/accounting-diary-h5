// @imgly/background-removal 1.7.0 (AGPL-3.0). See THIRD_PARTY.md.
// Only the model/runtime is downloaded. Photo pixels stay in this worker.
let remover;
const reportProgress = (key, current, total) => {
  const text = key.startsWith('fetch:')
    ? `首次加载抠图工具 ${Math.round(current / Math.max(1, total) * 100)}%…`
    : key === 'compute:inference' ? '正在找出照片里的主角…' : '正在修整边缘…';
  self.postMessage({ job: activeJob, type: 'progress', text });
};
let activeJob;
const config = { model: 'isnet_quint8', device: 'cpu', output: { format: 'image/png' }, progress: reportProgress };
self.onmessage = async ({ data: { job, source } }) => {
  activeJob = job;
  try {
    remover ||= (await import('https://esm.sh/@imgly/background-removal@1.7.0?deps=onnxruntime-web@1.21.0&target=es2022')).removeBackground;
    const blob = await remover(source, config);
    self.postMessage({ job, type: 'done', blob });
  } catch (error) {
    self.postMessage({ job, type: 'error', message: String(error) });
  }
};
