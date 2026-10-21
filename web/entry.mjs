import { createBrowserAPI } from './api.mjs';
try {
  globalThis.toeflOnline=await createBrowserAPI(new URL('../',import.meta.url));
  await import('../app.js');
} catch(error) {
  const panel=document.getElementById('app');
  panel.className='error-panel';panel.textContent=error.message+' 请检查网络并允许网站存储数据，然后刷新页面。';
}
