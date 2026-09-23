'use strict';

// Convert the approved transparent artwork into app/installer/server icon sizes.
// Uses Electron's existing image codec; no extra image-processing dependency.
// Usage: node scripts/assets/build_brand_icons.js path/to/transparent-square-logo.png
const fs=require('fs'),path=require('path'),assert=require('assert');
if(!process.versions.electron){
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
    const result=require('child_process').spawnSync(require('electron'),[__filename,...process.argv.slice(2)],{env,windowsHide:true,stdio:'inherit'});
    if(result.error)throw result.error;
    process.exit(result.status??1);
}
const {app,nativeImage}=require('electron');
app.whenReady().then(()=>{
    const input=process.argv[2];assert(input,'Pass a transparent square PNG');
    const source=nativeImage.createFromPath(path.resolve(input));assert(!source.isEmpty(),'Could not decode logo');
    const size=source.getSize();assert(size.width===size.height&&size.width>=512,'Use a square master at least 512px wide');
    const pixels=source.toBitmap();assert.strictEqual(pixels[3],0,'Logo background must be transparent');
    const assets=path.resolve(__dirname,'../../assets');
    fs.copyFileSync(path.resolve(input),path.join(assets,'fury-icon-source.png'));
    let left=size.width,top=size.height,right=0,bottom=0;
    for(let y=0;y<size.height;y++)for(let x=0;x<size.width;x++)if(pixels[(y*size.width+x)*4+3]>8){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
    assert(right>left&&bottom>top,'Logo has no visible artwork');
    const mark=source.crop({x:left,y:top,width:right-left+1,height:bottom-top+1}),bounds=mark.getSize();
    const pngAt=size=>{
        const scale=size*.88/Math.max(bounds.width,bounds.height),width=Math.round(bounds.width*scale),height=Math.round(bounds.height*scale);
        const bitmap=mark.resize({width,height,quality:'best'}).toBitmap(),square=Buffer.alloc(size*size*4);
        const x=Math.floor((size-width)/2),y=Math.floor((size-height)/2);
        for(let row=0;row<height;row++)bitmap.copy(square,((y+row)*size+x)*4,row*width*4,(row+1)*width*4);
        return nativeImage.createFromBitmap(square,{width:size,height:size}).toPNG();
    };
    fs.writeFileSync(path.join(assets,'fury-icon.png'),pngAt(1024));
    fs.writeFileSync(path.join(assets,'fury-server-icon.png'),pngAt(64));
    const sizes=[16,24,32,48,64,128,256],images=sizes.map(pngAt);
    const directory=Buffer.alloc(6+16*sizes.length);directory.writeUInt16LE(1,2);directory.writeUInt16LE(sizes.length,4);
    let offset=directory.length;
    images.forEach((png,i)=>{
        const entry=6+16*i;directory[entry]=directory[entry+1]=sizes[i]===256?0:sizes[i];
        directory.writeUInt16LE(1,entry+4);directory.writeUInt16LE(32,entry+6);
        directory.writeUInt32LE(png.length,entry+8);directory.writeUInt32LE(offset,entry+12);offset+=png.length;
    });
    fs.writeFileSync(path.join(assets,'fury-icon.ico'),Buffer.concat([directory,...images]));
    assert(!nativeImage.createFromPath(path.join(assets,'fury-icon.ico')).isEmpty(),'ICO did not decode');
    console.log(`Built 1024px app PNG, 64px server PNG and Windows ICO (${sizes.join(', ')}px).`);
    app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
