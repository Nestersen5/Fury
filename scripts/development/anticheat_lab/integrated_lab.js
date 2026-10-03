'use strict';
// A new lab variant, leaving the established lab and original captures intact.
const fs=require('fs'),path=require('path'),assert=require('assert'),Module=require('module'),crypto=require('crypto');
const file=path.join(__dirname,'lab.js'), root=path.resolve(__dirname,'../../..');
const base=path.join(root,'output/anticheat-lab/mod-real');
let source=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
function once(before,after){assert.strictEqual(source.split(before).length,2,before);source=source.replace(before,after);}
once("proxyFailoverHost: '127.0.0.1', proxyFailoverPort: failover, healthPort: health", "proxyFailoverHost: '127.0.0.1', proxyFailoverPort: failover, proxyCustomHost: '127.0.0.1', proxyCustomPort: 0, healthPort: health");
once('            tabStatsEnabled: false, nametagOverlayEnabled: false, autoScanOnGameStart: false',
    '            tabStatsEnabled: false, nametagOverlayEnabled: false, autoScanOnGameStart: false,\n            anticheatJumpResetEnabled: true, ...this.options.featureOverrides');
once("'src/detect/autoblockDetector.js', 'src/detect/stasisDetector.js', 'src/recorder/packetRecorder.js'", "'src/detect/autoblockDetector.js', 'src/detect/stasisDetector.js', 'src/recorder/packetRecorder.js',\n            'src/detect/jumpResetDetector.js', 'src/detect/jumpResetFeatures.js',\n            'src/detect/detectorPositionContext.js', 'src/detect/observerPacketClock.js'");
once("path.join(__dirname, 'offline_preload.js')", "path.join(__dirname, 'offline_preload_integrated.js')");
const compiled=new Module(file,module);compiled.filename=file;compiled.paths=Module._nodeModulePaths(__dirname);compiled._compile(source,file);
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
class IntegratedLab extends compiled.exports.Lab {
    constructor(directory,options={}) {
        super(directory,options);
        assert(path.resolve(directory).startsWith(path.join(base,'integration')+path.sep),'Integrated evidence must be isolated');
    }
    async start() {
        const appliedFile=path.join(base,'improvements/prepared-production/APPLIED.json');
        const applied=JSON.parse(fs.readFileSync(appliedFile));
        for(const [relative,entry]of Object.entries(applied.files))assert.strictEqual(hash(path.join(root,relative)),entry.afterSha256,'Integrated source changed: '+relative);
        await super.start();
        fs.writeFileSync(path.join(this.directory,'integration-source.json'),JSON.stringify({
            capturedAt:new Date().toISOString(),appliedManifestSha256:hash(appliedFile),
            adapterSha256:hash(__filename),preloadSha256:hash(path.join(__dirname,'offline_preload_integrated.js')),
            featureOverrides:this.options.featureOverrides||{},noOriginalMeasurementChanges:true
        },null,2)+'\n');
        return this;
    }
}
module.exports={...compiled.exports,Lab:IntegratedLab};
