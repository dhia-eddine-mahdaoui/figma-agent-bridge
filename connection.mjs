import net from 'node:net';
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
export const BRIDGE_PORTS = Object.freeze(Array.from({length:10},(_,i)=>4318+i));
export const PRODUCT='figma-local-bridge';
export const PROTOCOL=2;
export function bridgeUrl(port){if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid bridge port');return `http://127.0.0.1:${port}`;}
export function loopbackUrl(value){
 try{const url=new URL(value);if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)return null;const port=Number(url.port);return port>=1024&&port<=65535?url.origin:null;}catch{return null;}
}
export function healthProof(token,challenge){return createHmac('sha256',token).update(`${PRODUCT}/v${PROTOCOL}/${challenge}`).digest('hex');}
export async function compatibleHealth(url,token,fetcher=fetch){
 const origin=loopbackUrl(url);if(!origin)return null;
 const challenge=randomBytes(32).toString('hex');
 try{
  const response=await fetcher(`${origin}/health?challenge=${challenge}`,{signal:AbortSignal.timeout(800),redirect:'error'});
  const value=await response.json();if(!response.ok||value.product!==PRODUCT||value.protocol!==PROTOCOL)return null;
  const expected=Buffer.from(healthProof(token,challenge),'hex');const supplied=Buffer.from(typeof value.proof==='string'?value.proof:'','hex');
  return supplied.length===expected.length && timingSafeEqual(supplied,expected)?value:null;
 }catch{return null;}
}
// Bind the real server, not a probe: another process cannot steal a released port.
export async function listenAvailable(server,ports=BRIDGE_PORTS){
 for(const port of ports){
  try{
   await new Promise((resolve,reject)=>{const error=e=>{server.removeListener('listening',ready);reject(e);};const ready=()=>{server.removeListener('error',error);resolve();};server.once('error',error);server.once('listening',ready);server.listen(port,'127.0.0.1');});
   const selected=server.address().port;
   // localhost may prefer ::1. Own both loopback addresses so an unrelated
   // IPv6 service cannot shadow the verified IPv4 companion in the browser.
   const ipv6=net.createServer(socket=>server.emit('connection',socket));
   try{await new Promise((resolve,reject)=>{ipv6.once('error',reject);ipv6.listen(selected,'::1',resolve);});}
   catch(error){
    ipv6.close();
    if(!['EAFNOSUPPORT','EADDRNOTAVAIL'].includes(error.code)){await new Promise(resolve=>server.close(resolve));throw error;}
   }
   if(ipv6.listening)server.once('close',()=>ipv6.close());
   return selected;
  }
  catch(error){if(error.code!=='EADDRINUSE')throw error;}
 }
 throw new Error('All configured loopback ports are occupied. No unrelated process was stopped.');
}
