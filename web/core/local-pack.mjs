import { validateExam } from './contract.mjs';
export const MAX_PACK_BYTES=128*1024*1024;
const types={mp3:'audio/mpeg',m4a:'audio/mp4',wav:'audio/wav',ogg:'audio/ogg',webm:'audio/webm',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'};
export function examMedia(exam){return [...new Set(exam.groups.flatMap(g=>[...(g.images || []),...(g.audio?[g.audio]:[])]))].sort();}

export async function validateLocalPack(pack){
  if(pack?.kind!=='toefl-local-pack' || pack.schemaVersion!=='1.0' || !Array.isArray(pack.exams) || !pack.exams.length || pack.exams.length>10 || !Array.isArray(pack.media) || !Array.isArray(pack.files))throw Error('请选择本项目导出的本地题包 JSON，不能直接导入 Word、PDF 或作答评分包。');
  const exams=pack.exams.map(validateExam);
  if(new Set(exams.map(e=>e.id)).size!==exams.length)throw Error('题包存在重复试卷');
  const expected=[...new Set(exams.flatMap(examMedia))].sort(),urls=pack.media.map(m=>m.url).sort();
  if(JSON.stringify(expected)!==JSON.stringify(urls) || pack.media.length>5000 || pack.files.length>5000)throw Error('题包媒体与题目引用不一致');
  const files=new Map();let total=0;
  for(const file of pack.files){
    if(!/^[a-f0-9]{64}\.(mp3|m4a|wav|ogg|webm|png|jpg|jpeg|webp)$/.test(file.path) || !file.path.startsWith(file.sha256+'.') || files.has(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes<1 || typeof file.dataBase64!=='string' || file.dataBase64.length>MAX_PACK_BYTES*1.4)throw Error('题包包含无效媒体文件');
    total+=file.bytes;if(total>MAX_PACK_BYTES)throw Error('题包过大，请分别导入单套试卷');
    let decoded;try{decoded=atob(file.dataBase64);}catch{throw Error('题包音频或图片编码损坏');}
    if(decoded.length!==file.bytes)throw Error('题包媒体大小不一致，可能未传输完整');
    const bytes=Uint8Array.from(decoded,c=>c.charCodeAt(0)),hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
    const actual=[...hash].map(v=>v.toString(16).padStart(2,'0')).join('');
    if(actual!==file.sha256)throw Error('题包媒体校验失败，请重新复制原题包');
    files.set(file.path,{path:file.path,blob:new Blob([bytes],{type:types[file.path.split('.').at(-1)]})});
  }
  const referenced=new Set(pack.media.map(m=>m.path));
  if(referenced.size!==files.size || [...referenced].some(p=>!files.has(p)))throw Error('题包包含缺失或多余媒体');
  return {exams:structuredClone(exams),media:structuredClone(pack.media),files:[...files.values()],quality:structuredClone(pack.quality || {sets:[]})};
}
