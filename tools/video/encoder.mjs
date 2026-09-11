/** Deterministic frame export. WebCodecs encodes the supplied canvas; no
 * wall-clock recorder, display capture, audio, or frame-dropping timer is used. */
export async function createVideoEncoders({key,speeds=[1,20,60],fps=21,width=960,height=640,bitrate=1800000,uploadBase}) {
  const streams=[],errors=[];
  for(const speed of speeds) {
    const config={codec:'avc1.42001f',width,height,bitrate,framerate:fps,avc:{format:'annexb'},latencyMode:'realtime'};
    if(!(await VideoEncoder.isConfigSupported(config)).supported)throw new Error('This browser cannot encode the required H.264 video. Use a current Google Chrome installation.');
    const stream={speed,frames:0,chunks:0,bytes:0,pending:[],pendingBytes:0};
    stream.encoder=new VideoEncoder({output(chunk){
      const bytes=new Uint8Array(chunk.byteLength);chunk.copyTo(bytes);
      stream.pending.push(bytes);stream.pendingBytes+=bytes.length;stream.bytes+=bytes.length;stream.chunks++;
    },error:error=>errors.push(error.message)});
    stream.encoder.configure(config);streams.push(stream);
  }
  async function upload(stream) {
    if(!stream.pendingBytes)return;
    const body=new Uint8Array(stream.pendingBytes);let at=0;
    for(const part of stream.pending){body.set(part,at);at+=part.length;}
    stream.pending=[];stream.pendingBytes=0;
    const response=await fetch(`${uploadBase}/${encodeURIComponent(key)}/${stream.speed}`,{method:'POST',body});
    if(!response.ok)throw new Error(`Video write failed (${response.status}): ${await response.text()}`);
  }
  async function drain(force=false) {
    if(errors.length)throw new Error(errors.join('; '));
    if(force||streams.some(s=>s.encoder.encodeQueueSize>24))await Promise.all(streams.map(s=>s.encoder.flush()));
    await Promise.all(streams.filter(s=>force||s.pendingBytes>=512*1024).map(upload));
    if(errors.length)throw new Error(errors.join('; '));
  }
  let sourceFrames=0;
  return {
    async frame(canvas,{hold=false}={}) {
      for(const stream of streams)if(hold||sourceFrames%stream.speed===0) {
        const frame=new VideoFrame(canvas,{timestamp:Math.round(stream.frames*1e6/fps),duration:Math.round(1e6/fps)});
        stream.encoder.encode(frame,{keyFrame:stream.frames%(fps*5)===0});frame.close();stream.frames++;
      }
      sourceFrames++;await drain();
    },
    async finish() {
      await drain(true);
      for(const stream of streams){stream.encoder.close();if(stream.frames!==stream.chunks)throw new Error(`Encoded frame count mismatch at ${stream.speed}× (${stream.frames}/${stream.chunks})`);}
      return {sourceFrames,streams:streams.map(({speed,frames,chunks,bytes})=>({speed,frames,chunks,bytes,duration:frames/fps}))};
    },
    abort(){for(const stream of streams)if(stream.encoder.state!=='closed')stream.encoder.close();},
  };
}
