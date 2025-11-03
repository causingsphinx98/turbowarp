// fft-extension.js
// TurboWarp / Scratch 3 extension to compute FFT / IFFT on lists.
// Returns flattened complex lists: [re0, im0, re1, im1, ...]
// Author: ChatGPT (example). Use freely.

class FFTExtension {
    constructor (runtime) {
        this.runtime = runtime;
    }

    getInfo () {
        return {
            id: 'fft_extension',
            name: 'FFT',
            color1: '#4A90E2',
            color2: '#357ABD',
            color3: '#2D6CA6',
            blocks: [
                {
                    opcode: 'fft',
                    blockType: 'reporter',
                    text: 'FFT of list %1',
                    arguments: {
                        LIST: {
                            type: 'array',
                            defaultValue: []
                        }
                    }
                },
                {
                    opcode: 'ifft',
                    blockType: 'reporter',
                    text: 'IFFT of flattened complex list %1',
                    arguments: {
                        LIST: {
                            type: 'array',
                            defaultValue: []
                        }
                    }
                },
                {
                    opcode: 'magnitude',
                    blockType: 'reporter',
                    text: 'Magnitude of flattened complex list %1',
                    arguments: {
                        LIST: {
                            type: 'array',
                            defaultValue: []
                        }
                    }
                },
                {
                    opcode: 'nextPow2',
                    blockType: 'reporter',
                    text: 'Next power of two ≥ %1',
                    arguments: {
                        N: {
                            type: 'number',
                            defaultValue: 1
                        }
                    }
                }
            ],
            menus: {}
        };
    }

    // Reporter: FFT of a real-valued list (numbers or numeric strings).
    fft (args) {
        const inputList = args.LIST || [];
        // Convert to numbers
        const input = inputList.map(x => {
            const n = Number(x);
            return Number.isFinite(n) ? n : 0;
        });

        const n = nextPowerOfTwo(input.length);
        // pad with zeros
        const re = new Array(n).fill(0);
        const im = new Array(n).fill(0);
        for (let i = 0; i < input.length; i++) re[i] = input[i];

        fftInternal(re, im, false);

        // flatten as [re0, im0, re1, im1, ...]
        const out = new Array(n * 2);
        for (let i = 0; i < n; i++) {
            out[2 * i] = re[i];
            out[2 * i + 1] = im[i];
        }
        return out;
    }

    // Reporter: inverse FFT of a flattened complex list
    ifft (args) {
        const inList = args.LIST || [];
        // interpret flattened pairs; if odd length, last imag = 0
        const pairs = Math.ceil(inList.length / 2);
        const re = new Array(pairs).fill(0);
        const im = new Array(pairs).fill(0);
        for (let i = 0; i < pairs; i++) {
            re[i] = Number(inList[2 * i]) || 0;
            im[i] = Number(inList[2 * i + 1]) || 0;
        }

        const n = nextPowerOfTwo(pairs);
        // pad
        while (re.length < n) { re.push(0); im.push(0); }

        fftInternal(re, im, true);

        // result are real parts (imag should be near 0). We'll return flattened complex for symmetry.
        const out = new Array(n * 2);
        for (let i = 0; i < n; i++) {
            out[2 * i] = re[i];
            out[2 * i + 1] = im[i];
        }
        return out;
    }

    // Reporter: magnitudes from flattened complex list
    magnitude (args) {
        const inList = args.LIST || [];
        const pairs = Math.floor(inList.length / 2);
        const mags = new Array(pairs);
        for (let i = 0; i < pairs; i++) {
            const re = Number(inList[2 * i]) || 0;
            const im = Number(inList[2 * i + 1]) || 0;
            mags[i] = Math.hypot(re, im);
        }
        return mags;
    }

    // Reporter: next power of two >= N
    nextPow2 (args) {
        const n = Math.max(1, Math.floor(Number(args.N) || 0));
        return nextPowerOfTwo(n);
    }
}

// Helper: compute next power of two >= n
function nextPowerOfTwo (n) {
    if (n <= 1) return 1;
    let p = 1;
    while (p < n) p <<= 1;
    return p;
}

// In-place iterative Cooley-Tukey FFT
// re, im: arrays of length N=power-of-two
// inverse: boolean; if true, computes inverse FFT and scales by 1/N
function fftInternal (re, im, inverse) {
    const n = re.length;
    if (n === 0) return;
    // bit-reverse reorder
    let j = 0;
    for (let i = 0; i < n; i++) {
        if (i < j) {
            const tr = re[i]; re[i] = re[j]; re[j] = tr;
            const ti = im[i]; im[i] = im[j]; im[j] = ti;
        }
        let m = n >> 1;
        while (m >= 1 && j >= m) {
            j -= m;
            m >>= 1;
        }
        j += m;
    }

    // Danielson-Lanczos
    for (let len = 2; len <= n; len <<= 1) {
        const ang = (2 * Math.PI / len) * (inverse ? -1 : 1);
        const wlen_r = Math.cos(ang);
        const wlen_i = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
            let wr = 1;
            let wi = 0;
            for (let k = 0; k < (len >> 1); k++) {
                const u_r = re[i + k];
                const u_i = im[i + k];
                const v_r = re[i + k + (len >> 1)] * wr - im[i + k + (len >> 1)] * wi;
                const v_i = re[i + k + (len >> 1)] * wi + im[i + k + (len >> 1)] * wr;

                re[i + k] = u_r + v_r;
                im[i + k] = u_i + v_i;
                re[i + k + (len >> 1)] = u_r - v_r;
                im[i + k + (len >> 1)] = u_i - v_i;

                // rotate wr, wi by wlen
                const next_wr = wr * wlen_r - wi * wlen_i;
                const next_wi = wr * wlen_i + wi * wlen_r;
                wr = next_wr;
                wi = next_wi;
            }
        }
    }

    if (inverse) {
        // scale by 1/n
        for (let i = 0; i < n; i++) {
            re[i] /= n;
            im[i] /= n;
        }
    }
}

module.exports = FFTExtension;
