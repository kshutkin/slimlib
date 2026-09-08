// Production Chromium comparison; only jsx/src/core.ts varies.
// node tests/bench-keyed.mjs [baseline-ref] [samples]
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
const baselineRef = process.argv[2] ?? '495c0fe7703d4bb3784e90a05ad4a3c60b94ec6c';
const samples = Number(process.argv[3] ?? 15);
const variants = {
    baseline: execFileSync('git', ['show', `${baselineRef}:jsx/src/core.ts`], {cwd:root,encoding:'utf8'}),
    current: await readFile(`${root}jsx/src/core.ts`,'utf8'),
};
const entry = `
import {createElement as h,render,forEach} from './jsx/src/core.ts';
import {signal,flushEffects,setScheduler} from '@slimlib/store';
const noop=()=>{};
const immediate=fn=>fn();
const deferred=queueMicrotask;
function setup(kind,size,sync){
 setScheduler(sync?immediate:deferred);
 const base=Array.from({length:size},(_,id)=>({id,label:'row '+id}));
 let next=base.slice();
 if(kind==='rotate-right')next.unshift(next.pop());
 if(kind==='rotate-left')next.push(next.shift());
 if(kind==='swap')[next[1],next[size-2]]=[next[size-2],next[1]];
 if(kind==='reverse')next.reverse();
 if(kind==='shuffle'){
  let seed=0x12345678;
  for(let i=next.length-1;i>0;i--){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;const j=(seed>>>0)%(i+1);[next[i],next[j]]=[next[j],next[i]];}
 }
 if(kind==='append')next.push({id:size,label:'row '+size});
 if(kind==='prepend')next.unshift({id:-1,label:'row -1'});
 if(kind==='tail-update')next[size-1]={id:size-1,label:'updated'};
 if(kind==='remove')next=next.filter((_,i)=>i%3!==0);
 const items=signal(base);
 const container=document.createElement('div');document.body.append(container);
 const dispose=render(()=>h('ul',null,forEach(items,item=>item.id,item=>h('li',null,()=>item().label))),container);
 const parent=container.firstChild;
 const nodes=Array.from(parent.children);
 let toggle=false;
 return {
  parent,nodes,
  update(){toggle=!toggle;items.set(toggle?next:base);},
  check(){const expected=toggle?next:base;const actual=Array.from(parent.children);
   if(actual.length!==expected.length||actual.some((node,i)=>node.textContent!==expected[i].label))throw new Error('wrong order');
   if(kind!=='remove'&&actual.some((node,i)=>expected[i].id>=0&&expected[i].id<size&&node!==nodes[expected[i].id]))throw new Error('identity changed');
  },
  dispose(){dispose();container.remove();}
 };
}
globalThis.measure = async (kind,size,sync,count,operations=false)=>{
 const state=setup(kind,size,sync);
 let moves=0,inserts=0;
 if(operations){const original=state.parent.insertBefore;state.parent.insertBefore=function(node,anchor){if(node.parentNode===this)moves++;else inserts++;return original.call(this,node,anchor);};}
 const start=performance.now();for(let i=0;i<count;i++){
  state.update();
  // The list effect can schedule a row effect. Await both microtask stages
  // so timing and validation include the completed DOM update.
  if(!sync){await Promise.resolve();await Promise.resolve();}
 }const time=performance.now()-start;
 state.check();state.dispose();
 return {ms:time/count,moves,inserts};
};
`;
const server=createServer((req,res)=>{
    res.writeHead(200,{'Content-Type':'text/html','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'});
    res.end('<!doctype html><body></body>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,args:['--js-flags=--expose-gc']});
const pages={};
const sizes={};
const measurements={};
const operations={};
try {
    for(const [name,source] of Object.entries(variants)){
        const options={bundle:true,write:false,minify:true,format:'iife',platform:'browser',
            alias:{'@slimlib/store':`${root}store/src/index.ts`},define:{'process.env.NODE_ENV':'"production"'},
            plugins:[{name:'core-variant',setup(b){b.onLoad({filter:/\/jsx\/src\/core\.ts$/},()=>({contents:source,loader:'ts'}));}}]};
        const bundle=await build({...options,stdin:{contents:entry,loader:'ts',resolveDir:root}});
        const only=await build({...options,entryPoints:[`${root}jsx/src/for-each.ts`],format:'esm'});
        sizes[name]={minified:only.outputFiles[0].contents.length,gzip:gzipSync(only.outputFiles[0].contents).length};
        const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.addScriptTag({content:bundle.outputFiles[0].text});pages[name]=page;measurements[name]={};operations[name]={};
    }
    for(const size of [10,1000])for(const sync of [false,true])for(const kind of ['rotate-right','rotate-left','swap','shuffle','reverse','append','prepend','tail-update','remove']){
        const key=[size,sync?'sync':'default',kind].join('/');
        for(const [name,page] of Object.entries(pages))operations[name][key]=await page.evaluate(([kind,size,sync])=>measure(kind,size,sync,1,true),[kind,size,sync]);
        for(let round=-3;round<samples;round++){
            const names=Object.keys(pages);if(round%2===0)names.reverse();
            for(const name of names){
                const page=pages[name];await page.evaluate(()=>gc());
                const result=await page.evaluate(([kind,size,sync])=>measure(kind,size,sync,size===10?500:100),[kind,size,sync]);
                if(round>=0)(measurements[name][key]??=[]).push(result.ms);
            }
        }
        console.log('finished',key);
    }
    const median=xs=>xs.toSorted((a,b)=>a-b)[Math.floor(xs.length/2)];
    const summary=Object.fromEntries(Object.entries(measurements).map(([name,cases])=>[name,Object.fromEntries(Object.entries(cases).map(([key,values])=>[key,median(values)]))]));
    const result={baselineRef,samples,chromium:browser.version(),sizes,summary,operations,measurements};
    const output=process.env.KEYED_BENCH_OUTPUT??'/tmp/slimlib-keyed-benchmark.json';
    await writeFile(output,JSON.stringify(result,null,4)+'\n');
    console.log(JSON.stringify({sizes,summary,operations},null,2));console.log('Raw samples:',output);
}finally{await browser.close();server.close();}
