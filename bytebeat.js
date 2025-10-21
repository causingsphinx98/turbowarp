class BytebeatExtension {
  constructor(runtime) {
    this.runtime = runtime;
    this.audioCtx = null;
    this.scriptNode = null;
    this.t = 0;
    this.playing = false;
  }

  getInfo() {
    return {
      id: 'bytebeatPlayer',
      name: 'Bytebeat',
      color1: '#6c6cff',
      blocks: [
        {
          opcode: 'startBytebeat',
          blockType: 'command',
          text: 'start bytebeat'
        },
        {
          opcode: 'stopBytebeat',
          blockType: 'command',
          text: 'stop bytebeat'
        }
      ]
    };
  }

  startBytebeat() {
    if (this.playing) return;
    this.playing = true;

    if (!this.audioCtx) {
      try {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        console.error('Web Audio not supported:', e);
        this.playing = false;
        return;
      }
    }

    const bufferSize = 4096;
    this.scriptNode = this.audioCtx.createScriptProcessor(bufferSize, 0, 1);

    const targetRate = 8000; // Desired bytebeat sample rate
    const actualRate = this.audioCtx.sampleRate;
    const rateScale = targetRate / actualRate;

    this.scriptNode.onaudioprocess = (event) => {
      const output = event.outputBuffer.getChannelData(0);
      const len = output.length;
      for (let i = 0; i < len; i++) {
        const t = this.t | 0;

        // Original bytebeat formula
        const part1 = ((t * t) >> 0xFFF2) & (t >> 5);
        const part2 = ((t * t) >> 0xFFD2) & (t >> 5);
        const y = (part1 | part2) * 255;

        const byte8 = (y | 0) & 0xFF;
        const sample = (byte8 / 128.0) - 1.0;

        output[i] = sample;
        this.t += rateScale; // increment at 8kHz rate
      }
    };

    this.scriptNode.connect(this.audioCtx.destination);
  }

  stopBytebeat() {
    if (!this.playing) return;
    this.playing = false;
    if (this.scriptNode) {
      this.scriptNode.disconnect();
      this.scriptNode.onaudioprocess = null;
      this.scriptNode = null;
    }
    this.t = 0;
  }
}

(function() {
  if (typeof Scratch !== 'undefined' && Scratch.extensions) {
    Scratch.extensions.register(new BytebeatExtension());
  } else if (typeof window.vm !== 'undefined') {
    window.vm.extensionManager._registerInternalExtension(new BytebeatExtension(window.vm.runtime));
  } else {
    console.error('Could not register Bytebeat extension automatically.');
  }
})();
