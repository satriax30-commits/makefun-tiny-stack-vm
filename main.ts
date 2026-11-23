// Tiny stack VM for make.fun tiny-stack-vm-01-run-20261122: a faithful port
// of the kit's reference VM (generator/subject/vm.mjs + ISA.md). Deterministic.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Per-opcode info, one byte each: bit 7 = known, bits 6-4 = immediate
// length (0,1,2,4), bits 3-2 = pops, bits 1-0 = pushes.
const INFO = new Uint8Array(256);
const Q = [0,0,0,0, 1,1,0,1, 2,4,0,1, 3,0,1,0, 4,0,1,2, 5,0,2,2, 6,0,2,3,
  7,0,3,3, 16,0,2,1, 17,0,2,1, 18,0,2,1, 19,0,2,1, 20,0,2,1, 21,0,2,1,
  22,0,2,1, 23,0,1,1, 24,0,2,1, 25,0,2,1, 26,0,2,1, 27,0,1,1, 28,0,2,1,
  29,0,2,1, 30,0,2,1, 32,0,2,1, 33,0,2,1, 34,0,2,1, 48,2,0,0, 49,2,1,0,
  50,2,1,0, 51,2,0,0, 52,0,0,0, 64,0,1,1, 65,0,2,0, 80,0,1,0, 81,0,1,0,
  82,0,0,1, 83,0,1,0];
for (let i = 0; i < Q.length; i += 4) INFO[Q[i]] = 128 | (Q[i + 1] << 4) | (Q[i + 2] << 2) | Q[i + 3];

const DIG = new Uint8Array(11); // PRINT scratch: at most "-2147483648"

function run(p: Uint8Array, inp: Uint8Array): { out: Uint8Array; len: number; code: number } {
  const n = p.length;
  const D = new Int32Array(256);
  let sp = 0;
  const C = new Int32Array(64);
  let csp = 0;
  const M = new Int32Array(256);
  const out = new Uint8Array(65536);
  let olen = 0;
  let ip = 0;
  let pc = 0;
  let steps = 0;
  const end = (code: number) => ({ out, len: olen, code });
  for (;;) {
    // One step, in ISA.md's order.
    if (steps === 1000000) return end(10);
    if (pc < 0 || pc >= n) return end(9);
    const op = p[pc];
    const info = INFO[op];
    if (info < 128) return end(5);
    const imm = (info >> 4) & 7;
    if (imm && pc + imm >= n) return end(9);
    steps++;
    const pops = (info >> 2) & 3;
    if (sp < pops) return end(2);
    if (sp > 253 && sp - pops + (info & 3) > 256) return end(3); // max net push is +1
    const next = pc + 1 + imm;
    pc = next;
    if (op >= 0x10 && op <= 0x22 && op !== 0x17 && op !== 0x1b) {
      const b = D[sp - 1];
      const a = D[sp - 2];
      let r: number;
      switch (op) {
        case 0x10: r = (a + b) | 0; break;
        case 0x11: r = (a - b) | 0; break;
        case 0x12: r = Math.imul(a, b); break;
        case 0x13:
          if (b === 0) return end(4);
          r = a === -2147483648 && b === -1 ? a : (a / b) | 0;
          break;
        case 0x14:
          if (b === 0) return end(4);
          r = b === -1 ? 0 : (a % b) | 0;
          break;
        case 0x15:
          if (b === 0) return end(4);
          r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
          break;
        case 0x16:
          if (b === 0) return end(4);
          r = ((a >>> 0) % (b >>> 0)) | 0;
          break;
        case 0x18: r = a & b; break;
        case 0x19: r = a | b; break;
        case 0x1a: r = a ^ b; break;
        case 0x1c: r = a << (b & 31); break;
        case 0x1d: r = a >> (b & 31); break;
        case 0x1e: r = (a >>> (b & 31)) | 0; break;
        case 0x20: r = a === b ? 1 : 0; break;
        case 0x21: r = a < b ? 1 : 0; break;
        default: r = (a >>> 0) < (b >>> 0) ? 1 : 0; // LTU
      }
      sp -= 2;
      D[sp++] = r;
      continue;
    }
    switch (op) {
      case 0x00:
        return end(0);
      case 0x01:
        D[sp++] = (p[next - 1] << 24) >> 24;
        break;
      case 0x02:
        D[sp++] = p[next - 4] | (p[next - 3] << 8) | (p[next - 2] << 16) | (p[next - 1] << 24);
        break;
      case 0x03:
        sp--;
        break;
      case 0x04:
        D[sp] = D[sp - 1];
        sp++;
        break;
      case 0x05: {
        const t = D[sp - 1];
        D[sp - 1] = D[sp - 2];
        D[sp - 2] = t;
        break;
      }
      case 0x06:
        D[sp] = D[sp - 2];
        sp++;
        break;
      case 0x07: {
        const a = D[sp - 3];
        D[sp - 3] = D[sp - 2];
        D[sp - 2] = D[sp - 1];
        D[sp - 1] = a;
        break;
      }
      case 0x17:
        D[sp - 1] = (-D[sp - 1]) | 0;
        break;
      case 0x1b:
        D[sp - 1] = ~D[sp - 1];
        break;
      case 0x30: case 0x31: case 0x32: {
        const rel = ((p[next - 2] | (p[next - 1] << 8)) << 16) >> 16;
        let take = true;
        if (op !== 0x30) {
          const v = D[--sp];
          take = op === 0x31 ? v === 0 : v !== 0;
        }
        if (take) pc = next + rel;
        break;
      }
      case 0x33:
        if (csp === 64) return end(7);
        C[csp++] = next;
        pc = p[next - 2] | (p[next - 1] << 8);
        break;
      case 0x34:
        if (csp === 0) return end(8);
        pc = C[--csp];
        break;
      case 0x40: {
        const addr = D[sp - 1];
        if (addr < 0 || addr >= 256) return end(6);
        D[sp - 1] = M[addr];
        break;
      }
      case 0x41: {
        const addr = D[sp - 1];
        const v = D[sp - 2];
        if (addr < 0 || addr >= 256) return end(6);
        sp -= 2;
        M[addr] = v;
        break;
      }
      case 0x50: {
        const v = D[sp - 1];
        let u = v;
        let d = 11;
        if (v < 0) u = -v;
        if (u === 0) DIG[--d] = 48;
        else while (u > 0) { DIG[--d] = 48 + (u % 10); u = (u / 10) | 0; }
        const len = 11 - d + (v < 0 ? 1 : 0);
        if (olen + len > 65536) return end(11);
        sp--;
        if (v < 0) out[olen++] = 45;
        out.set(DIG.subarray(d), olen);
        olen += 11 - d;
        break;
      }
      case 0x51:
        if (olen + 1 > 65536) return end(11);
        out[olen++] = D[--sp] & 255;
        break;
      case 0x52:
        D[sp++] = ip < inp.length ? inp[ip++] : -1;
        break;
      case 0x53:
        return end(D[--sp] & 255);
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const r = run(readFileSync(join(I, id, 'program.bin')), readFileSync(join(I, id, 'input.bin')));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.out.subarray(0, r.len));
  writeFileSync(join(O, id, 'exit.txt'), r.code + '\n');
}
