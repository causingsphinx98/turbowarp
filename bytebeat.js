// yoog.js
// TurboWarp / Scratch 3.0 extension — Bytebeat player with AudioWorklet + ScriptProcessor fallback
// Features:
// - AudioWorklet preferred; silently falls back to ScriptProcessor when unavailable
// - Live formula updates, logical sample rate, buffer size preference, and linear volume (0..1)
// - Recording to WAV
// - Error-fallback formula: t*(t^t+(t>>15|1)^(t-1280^t)>>10)
// - Single "set [PROPERTY] to [VALUE]" block (Volume / Sample rate / Buffer size)
// Paste this file into TurboWarp → Extensions → Create → add code, or save as "yoog.js" and point TurboWarp to it.

(function (Scratch) {
    'use strict';

    // ------------------------
    // Config
    // ------------------------
    const ERROR_FALLBACK_FORMULA = 't*(t^t+(t>>15|1)^(t-1280^t)>>10)';
    const workletSource = `
    const ERROR_FALLBACK = "${ERROR_FALLBACK_FORMULA}";

    class BytebeatProcessor extends AudioWorkletProcessor {
        static get parameterDescriptors() {
            return [
                { name: 'volume', defaultValue: 1, minValue: 0, maxValue: 4 },
                { name: 'logicalS', defaultValue: 8000, minValue: 100, maxValue: 192000 }
            ];
        }
        constructor() {
            super();
            this.t = 0.0;
            this.compiled = null;
            this.recording = false;
            this.recordBuffer = [];
            this.recordChunkSize = 4096;

            this.port.onmessage = (e) => {
                const d = e.data;
                if (!d) return;
                if (d.type === 'setFormula') this._setFormula(d.formula);
                else if (d.type === 'record') this._setRecording(!!d.on);
                else if (d.type === 'setChunkSize') this.recordChunkSize = Math.max(128, Math.min(65536, Number(d.size) || this.recordChunkSize));
                else if (d.type === 'resetTime') this.t = 0.0;
            };

            this._setFormula(ERROR_FALLBACK);
        }

        _setRecording(on) {
            this.recording = !!on;
            if (!this.recording) this._flushRecord();
        }

        _flushRecord() {
            if (this.recordBuffer.length > 0) {
                try {
                    const chunk = new Float32Array(this.recordBuffer);
                    this.port.postMessage({ type: 'recordChunk', chunk: chunk }, [chunk.buffer]);
                } catch (e) {
                    this.port.postMessage({ type: 'recordChunk', chunk: this.recordBuffer.slice(0) });
                }
                this.recordBuffer = [];
            }
        }

        _setFormula(formulaText) {
            try {
                this.compiled = new Function('t','s','T','return (' + formulaText + ')|0;');
                // quick smoke test
                this.compiled(0,8000,0);
            } catch (err) {
                try {
                    this.compiled = new Function('t','s','T','return (' + ERROR_FALLBACK + ')|0;');
                    this.port.postMessage({ type: 'error', message: 'Compile error; switched to fallback formula: ' + (err && err.message ? err.message : String(err)) });
                } catch (ee) {
                    this.compiled = null;
                    this.port.postMessage({ type: 'error', message: 'Compile failed and fallback failed: ' + String(ee && ee.message ? ee.message : ee) });
                }
            }
        }

        process(inputs, outputs, parameters) {
            const out = outputs[0];
            if (!out || !out[0]) return true;
            const output = out[0];
            const sr = sampleRate;
            const volParam = parameters.volume;
            const sParam = parameters.logicalS;

            const logicalS_quantum = sParam.length === 1 ? sParam[0] : sParam[0];
            const incrementPerAudioSample = logicalS_quantum / sr;

            for (let i = 0; i < output.length; i++) {
                const vol = volParam.length === 1 ? volParam[0] : volParam[i];
                const currentS = sParam.length === 1 ? sParam[0] : sParam[i];

                let raw = 0;
                if (this.compiled) {
                    try {
                        raw = this.compiled(Math.floor(this.t), currentS, this.t / currentS);
                    } catch (err) {
                        try {
                            this.compiled = new Function('t','s','T','return (' + ERROR_FALLBACK + ')|0;');
                            this.port.postMessage({ type: 'error', message: 'Runtime error; switched to fallback formula: ' + (err && err.message ? err.message : String(err)) });
                        } catch (ee) {
                            this.compiled = null;
                            this.port.postMessage({ type: 'error', message: 'Runtime error and fallback failed: ' + String(ee && ee.message ? ee.message : ee) });
                        }
                        raw = 0;
                    }
                } else {
                    raw = 0;
                }

                const v8 = (raw | 0) & 255;
                let sample = (v8 / 128) - 1;
                sample = sample * vol;

                output[i] = sample;

                if (this.recording) {
                    this.recordBuffer.push(sample);
                    if (this.recordBuffer.length >= this.recordChunkSize) this._flushRecord();
                }
                this.t += incrementPerAudioSample;
            }
            return true;
        }
    }

    registerProcessor('bytebeat-processor', BytebeatProcessor);
    `;

    // ------------------------
    // Extension
    // ------------------------
    class BytebeatExtension {
        constructor(runtime) {
            this.runtime = runtime;

            this.audioCtx = null;
            this.node = null;
            this.isPlaying = false;
            this._usingWorklet = false;
            this._workletLoaded = false;

            this.logicalSampleRate = 8000;
            this.volume = 1.0;
            this.formula = '(t*(t>>5|t>>8))>>(t>>16)';

            this.recording = false;
            this.recordedSamples = [];
            this.recordMaxSamples = 44100 * 60 * 10;
            this.preferredChunkSize = 4096;

            // script fallback state placeholders
            this._handleScriptMessage = () => {};
        }

        getInfo() {
            return {
                id: 'yoog',
                name: 'yoog',
                color1: '#2ECC71',
                color2: '#27AE60',
                blocks: [
                    {
                        opcode: 'startFormula',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'start bytebeat with formula [FORMULA]',
                        arguments: { FORMULA: { type: Scratch.ArgumentType.STRING, defaultValue: '(t*(t>>5|t>>8))>>(t>>16)' } }
                    },
                    { opcode: 'stop', blockType: Scratch.BlockType.COMMAND, text: 'stop bytebeat' },
                    {
                        opcode: 'setProperty',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'set [PROPERTY] to [VALUE]',
                        arguments: {
                            PROPERTY: { type: Scratch.ArgumentType.STRING, defaultValue: 'Volume' },
                            VALUE: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 }
                        }
                    },
                    { opcode: 'isPlaying', blockType: Scratch.BlockType.BOOLEAN, text: 'is playing' },
                    { opcode: 'recordStart', blockType: Scratch.BlockType.COMMAND, text: 'start recording to WAV' },
                    { opcode: 'recordStopSave', blockType: Scratch.BlockType.COMMAND, text: 'stop recording and save WAV [FILENAME]', arguments: { FILENAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'bytebeat.wav' } } },
                    { opcode: 'exampleFormula', blockType: Scratch.BlockType.REPORTER, text: 'example formula [N]', arguments: { N: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 } } }
                ],
                menus: {
                    PROPERTY: ['Volume', 'Sample rate', 'Buffer size']
                }
            };
        }

        // -------------------------
        // Blocks
        // -------------------------
        async startFormula(args) {
            this.formula = String(args.FORMULA || this.formula).trim();
            try {
                this._sanityCheckFormula(this.formula);
            } catch (e) {
                console.warn('Formula rejected by sanity check:', e && e.message);
                this.formula = ERROR_FALLBACK_FORMULA;
            }

            await this._ensureAudioPrepared();
            // ensure audio context resumed on user gesture
            if (this.audioCtx && this.audioCtx.state === 'suspended') {
                this.audioCtx.resume().catch(()=>{});
            }

            this._postToNode({ type: 'setFormula', formula: this.formula });
            if (!this.isPlaying) this._startAudio();
        }

        stop() {
            this._stopAudio();
        }

        // unified property setter block handler
        setProperty(args) {
            const prop = String(args.PROPERTY || 'Volume');
            const value = Number(args.VALUE);

            if (/^volume$/i.test(prop)) {
                // treat value as linear 0..1 (clamp)
                const clamped = Math.max(0, Math.min(4, isNaN(value) ? 1 : value));
                this.volume = clamped;
                if (this.node && this._usingWorklet) {
                    try { this.node.parameters.get('volume').setValueAtTime(this.volume, this.audioCtx.currentTime); }
                    catch (e) { this._postToNode({ type: 'setVolume', value: this.volume }); }
                }
            } else if (/^sample\s*rate$/i.test(prop)) {
                const clamped = Math.max(100, Math.min(192000, Math.round(isNaN(value) ? 8000 : value)));
                this.logicalSampleRate = clamped;
                if (this.node && this._usingWorklet) {
                    try { this.node.parameters.get('logicalS').setValueAtTime(clamped, this.audioCtx.currentTime); }
                    catch (e) { this._postToNode({ type: 'setLogicalS', value: clamped }); }
                }
            } else if (/^buffer\s*size$/i.test(prop)) {
                const size = Math.max(128, Math.min(65536, Math.round(isNaN(value) ? this.preferredChunkSize : value)));
                this.preferredChunkSize = size;
                if (this.node && this._usingWorklet) this._postToNode({ type: 'setChunkSize', size: this.preferredChunkSize });
                if (!this._usingWorklet && this.isPlaying) this._recreateScriptProcessor();
            } else {
                console.warn('Unknown property in setProperty:', prop);
            }
        }

        isPlaying() {
            return !!this.isPlaying;
        }

        recordStart() {
            this.recordedSamples = [];
            this.recording = true;
            this._postToNode({ type: 'record', on: true });
        }

        recordStopSave(args) {
            const filename = String(args.FILENAME || 'bytebeat.wav');
            this.recording = false;
            this._postToNode({ type: 'record', on: false });

            if (!this.recordedSamples || this.recordedSamples.length === 0) {
                alert('No audio recorded.');
                return;
            }
            const wav = this._makeWavBlob(this.recordedSamples, this.audioCtx ? this.audioCtx.sampleRate : 44100);
            const url = URL.createObjectURL(wav);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                URL.revokeObjectURL(url);
                a.remove();
            }, 1000);
            this.recordedSamples = [];
        }

        exampleFormula(args) {
            const n = Math.max(1, Math.floor(Number(args.N) || 1));
            const examples = [
                '(t*(t>>5|t>>8))>>(t>>16)',
                '((t>>6|t>>8|t>>9)&63)',
                '(t*9&t>>4)|((t*5&t>>7))',
                '((t*(t>>11|t>>8))&(255))',
                '(t*( (t>>11) | (t>>8) ))&255'
            ];
            return examples[(n - 1) % examples.length];
        }

        // -------------------------
        // Prepare audio (worklet or script fallback)
        // -------------------------
        async _ensureAudioPrepared() {
            if (!this.audioCtx) {
                try {
                    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                } catch (e) {
                    alert('Web Audio API not supported.');
                    throw e;
                }
            }

            // try to add worklet module if available and not loaded
            if (window.AudioWorklet && window.AudioWorkletNode && !this._workletLoaded) {
                const blob = new Blob([workletSource], { type: 'application/javascript' });
                const url = URL.createObjectURL(blob);
                try {
                    await this.audioCtx.audioWorklet.addModule(url);
                    this._workletLoaded = true;
                } catch (err) {
                    // silent fallback requested
                    console.info('AudioWorklet addModule failed — falling back to ScriptProcessorNode. (Expected in packaged HTML).', err && err.message);
                    this._workletLoaded = false;
                } finally {
                    URL.revokeObjectURL(url);
                }
            }

            this._usingWorklet = !!this._workletLoaded;
        }

        // -------------------------
        // Start/stop audio
        // -------------------------
        _startAudio() {
            if (!this.audioCtx) return;
            if (this.isPlaying) return;

            if (this._usingWorklet) {
                // ensure resumed
                if (this.audioCtx.state === 'suspended') this.audioCtx.resume().catch(()=>{});
                this.node = new AudioWorkletNode(this.audioCtx, 'bytebeat-processor', {
                    numberOfOutputs: 1,
                    outputChannelCount: [1],
                    parameterData: { volume: this.volume, logicalS: this.logicalSampleRate }
                });
                this.node.port.onmessage = (e) => this._handleNodeMessage(e.data);
                this.node.connect(this.audioCtx.destination);
                this._postToNode({ type: 'setChunkSize', size: this.preferredChunkSize });
                this._postToNode({ type: 'setFormula', formula: this.formula });
            } else {
                // ScriptProcessor fallback
                if (this.audioCtx.state === 'suspended') this.audioCtx.resume().catch(()=>{});
                this._createScriptProcessor(this.preferredChunkSize);
                // tell script node current formula & recording state
                this._handleScriptMessage({ type: 'setFormula', formula: this.formula });
                this._handleScriptMessage({ type: 'record', on: this.recording });
            }

            this.isPlaying = true;
        }

        _stopAudio() {
            if (!this.isPlaying) return;
            if (this.node) {
                try {
                    this._postToNode({ type: 'record', on: false });
                    this.node.disconnect();
                } catch (e) {}
                this.node = null;
            }
            this.isPlaying = false;
        }

        _postToNode(msg) {
            if (!this.node) return;
            try {
                if (this._usingWorklet && this.node.port) this.node.port.postMessage(msg);
                else if (!this._usingWorklet) this._handleScriptMessage(msg);
            } catch (e) {
                console.warn('postToNode failed', e);
            }
        }

        _handleNodeMessage(data) {
            if (!data) return;
            if (data.type === 'error') {
                // notify and ensure fallback formula is set
                alert('Bytebeat worklet error: ' + data.message + '\nSwitching to error fallback pattern.');
                this._postToNode({ type: 'setFormula', formula: ERROR_FALLBACK_FORMULA });
            } else if (data.type === 'recordChunk') {
                const chunk = data.chunk;
                if (chunk instanceof Float32Array) {
                    for (let i = 0; i < chunk.length; i++) this.recordedSamples.push(chunk[i]);
                } else if (Array.isArray(chunk)) {
                    for (let i = 0; i < chunk.length; i++) this.recordedSamples.push(Number(chunk[i]) || 0);
                }
                if (this.recordedSamples.length > this.recordMaxSamples) {
                    this.recording = false;
                    this.recordedSamples.length = 0;
                    this._postToNode({ type: 'record', on: false });
                    alert('Recording stopped — reached maximum allowed length.');
                }
            }
        }

        // -------------------------
        // ScriptProcessor fallback
        // -------------------------
        _createScriptProcessor(bufferSize) {
            const bs = Math.max(256, Math.min(16384, Math.round(bufferSize || 1024)));
            try {
                this.node = this.audioCtx.createScriptProcessor ? this.audioCtx.createScriptProcessor(bs, 0, 1) : this.audioCtx.createJavaScriptNode(bs, 0, 1);
            } catch (e) {
                try {
                    this.node = this.audioCtx.createScriptProcessor(1024, 0, 1);
                } catch (err) {
                    alert('Failed to create ScriptProcessorNode fallback.');
                    throw err;
                }
            }

            const self = this;
            let t = 0.0;
            const sr = this.audioCtx.sampleRate;

            this._scriptCompiledFunc = null;
            this._scriptRecordBuffer = [];
            this._scriptRecording = false;
            this._scriptRecordChunkSize = this.preferredChunkSize;

            try {
                this._scriptCompiledFunc = new Function('t','s','T','return (' + this.formula + ')|0;');
                this._scriptCompiledFunc(0, this.logicalSampleRate, 0);
            } catch (e) {
                try {
                    this._scriptCompiledFunc = new Function('t','s','T','return (' + ERROR_FALLBACK_FORMULA + ')|0;');
                    console.warn('ScriptProcessor compiled fallback due to compile error:', e && e.message);
                } catch (ee) {
                    this._scriptCompiledFunc = null;
                    console.error('ScriptProcessor fallback compile failed', ee && ee.message);
                }
            }

            const processFunc = function (audioProcessingEvent) {
                const outputBuffer = audioProcessingEvent.outputBuffer;
                const out = outputBuffer.getChannelData(0);
                const blockLen = out.length;
                const logicalS = Math.max(1, self.logicalSampleRate || 8000);
                const increment = logicalS / sr;

                for (let i = 0; i < blockLen; i++) {
                    let raw = 0;
                    if (self._scriptCompiledFunc) {
                        try {
                            raw = self._scriptCompiledFunc(Math.floor(t), logicalS, t / logicalS);
                        } catch (err) {
                            try {
                                self._scriptCompiledFunc = new Function('t','s','T','return (' + ERROR_FALLBACK_FORMULA + ')|0;');
                                console.warn('ScriptProcessor runtime error — switched to fallback:', err && err.message);
                            } catch (ee) {
                                self._scriptCompiledFunc = null;
                                console.error('ScriptProcessor fallback failed', ee && ee.message);
                            }
                            raw = 0;
                        }
                    } else raw = 0;

                    const v8 = (raw | 0) & 255;
                    let sample = (v8 / 128) - 1;
                    sample = sample * (self.volume || 1.0);

                    out[i] = sample;

                    if (self._scriptRecording) {
                        self._scriptRecordBuffer.push(sample);
                        if (self._scriptRecordBuffer.length >= self._scriptRecordChunkSize) {
                            try {
                                const chunk = new Float32Array(self._scriptRecordBuffer);
                                self._handleNodeMessage({ type: 'recordChunk', chunk: chunk });
                            } catch (e) {
                                self._handleNodeMessage({ type: 'recordChunk', chunk: self._scriptRecordBuffer.slice(0) });
                            }
                            self._scriptRecordBuffer = [];
                        }
                    }
                    t += increment;
                }
            };

            this.node.onaudioprocess = processFunc;

            this._handleScriptMessage = (msg) => {
                if (!msg || !msg.type) return;
                if (msg.type === 'setFormula') {
                    try {
                        this._scriptCompiledFunc = new Function('t','s','T','return (' + msg.formula + ')|0;');
                        t = 0.0;
                    } catch (e) {
                        try {
                            this._scriptCompiledFunc = new Function('t','s','T','return (' + ERROR_FALLBACK_FORMULA + ')|0;');
                        } catch (ee) {
                            this._scriptCompiledFunc = null;
                        }
                    }
                } else if (msg.type === 'record') {
                    this._scriptRecording = !!msg.on;
                    if (!this._scriptRecording) {
                        if (this._scriptRecordBuffer.length > 0) {
                            try {
                                const chunk = new Float32Array(this._scriptRecordBuffer);
                                this._handleNodeMessage({ type: 'recordChunk', chunk: chunk });
                            } catch (err) {
                                this._handleNodeMessage({ type: 'recordChunk', chunk: this._scriptRecordBuffer.slice(0) });
                            }
                            this._scriptRecordBuffer = [];
                        }
                    }
                } else if (msg.type === 'setChunkSize') {
                    this._scriptRecordChunkSize = Math.max(128, Math.min(65536, Number(msg.size) || this._scriptRecordChunkSize));
                } else if (msg.type === 'resetTime') {
                    t = 0.0;
                } else if (msg.type === 'setVolume') {
                    // handled by reading this.volume from closure
                }
            };

            this.node.connect(this.audioCtx.destination);
        }

        _recreateScriptProcessor() {
            if (this.node) {
                try {
                    this.node.disconnect();
                    this.node.onaudioprocess = null;
                } catch (e) {}
                this.node = null;
            }
            this._createScriptProcessor(this.preferredChunkSize);
            this._handleScriptMessage({ type: 'record', on: this.recording });
            this._handleScriptMessage({ type: 'setFormula', formula: this.formula });
        }

        // -------------------------
        // Utils
        // -------------------------
        _makeWavBlob(samplesFloatArray, sampleRate) {
            const len = samplesFloatArray.length;
            const buffer = new ArrayBuffer(44 + len * 2);
            const view = new DataView(buffer);

            function writeString(view, offset, string) {
                for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
            }

            writeString(view, 0, 'RIFF');
            view.setUint32(4, 36 + len * 2, true);
            writeString(view, 8, 'WAVE');
            writeString(view, 12, 'fmt ');
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true);
            view.setUint16(22, 1, true);
            view.setUint32(24, sampleRate, true);
            view.setUint32(28, sampleRate * 2, true);
            view.setUint16(32, 2, true);
            view.setUint16(34, 16, true);
            writeString(view, 36, 'data');
            view.setUint32(40, len * 2, true);

            let offset = 44;
            for (let i = 0; i < len; i++, offset += 2) {
                let s = Math.max(-1, Math.min(1, samplesFloatArray[i]));
                const int16 = s < 0 ? s * 0x8000 : s * 0x7FFF;
                view.setInt16(offset, Math.round(int16), true);
            }
            return new Blob([view], { type: 'audio/wav' });
        }

        _sanityCheckFormula(formula) {
            const forbidden = ['while','for','function','=>','await','async','import','export','constructor','this','XMLHttpRequest','fetch','setInterval','setTimeout'];
            for (const f of forbidden) {
                if (formula.includes(f)) throw new Error('Formula contains forbidden substring: ' + f);
            }
            if (formula.length > 2000) throw new Error('Formula too long');
        }
    }

    Scratch.extensions.register(new BytebeatExtension());
})(window.Scratch);
