// Auto-detects device hardware (low-end laptop → mid-range PC → high-end GPU → ultra workstation/server)
// so `npm run build-models` and `server.js` pick the right model sizes, context window, CPU threads, and thinking depth.
import os from 'os';
import { spawnSync } from 'child_process';

function detectGpu() {
  if (process.env.VERCEL) return { vramGb: 0, gpuName: null, unified: false };
  // Apple Silicon uses fast unified GPU memory (~75% usable by Metal)
  if (os.platform() === 'darwin' && os.arch() === 'arm64') {
    const ramGb = os.totalmem() / 1024 ** 3;
    return { vramGb: +(ramGb * 0.7).toFixed(1), gpuName: os.cpus()[0]?.model || 'Apple Silicon', unified: true };
  }
  try {
    const r = spawnSync('nvidia-smi', ['--query-gpu=memory.total,name', '--format=csv,noheader,nounits'], {
      encoding: 'utf8', timeout: 3000, windowsHide: true,
    });
    if (r.status === 0 && r.stdout.trim()) {
      const best = r.stdout.trim().split(/\r?\n/).map((line) => {
        const [mem, ...rest] = line.split(',');
        return { vramGb: +(Number(mem.trim()) / 1024).toFixed(1) || 0, gpuName: rest.join(',').trim() || 'NVIDIA GPU' };
      }).sort((a, b) => b.vramGb - a.vramGb)[0];
      if (best?.vramGb > 0) return { ...best, unified: false };
    }
  } catch {}
  return { vramGb: 0, gpuName: null, unified: false };
}

function detectPhysicalCores() {
  const logical = os.cpus().length || 4;
  if (os.platform() === 'darwin') return logical;
  // On x86 laptops/desktops with SMT/Hyper-Threading, using physical core count avoids 20-35% cache/SIMD contention
  return Math.max(2, Math.min(16, Math.floor(logical / 2) || logical));
}

export function detectHardware(overrideTier = process.env.EVOLVIX_TIER) {
  const ramGb = +(os.totalmem() / 1024 ** 3).toFixed(1);
  const logicalCores = os.cpus().length || 4;
  const physicalCores = detectPhysicalCores();
  const cpuModel = (os.cpus()[0]?.model || 'CPU').trim();
  const { vramGb, gpuName, unified } = detectGpu();
  const hasGpu = vramGb >= 4;

  let tier = String(overrideTier || '').toLowerCase();
  if (!['low', 'mid', 'high', 'ultra'].includes(tier)) {
    if (vramGb >= 16 || (unified && ramGb >= 30)) tier = 'ultra';
    else if (vramGb >= 8 || (unified && ramGb >= 15) || ramGb >= 28) tier = 'high';
    else if (ramGb >= 12 || vramGb >= 4) tier = 'mid';
    else tier = 'low';
  }

  // Optimal model choices per device tier (zero disk-swap thrashing + best accuracy for the hardware)
  const profiles = {
    low: {
      label: 'Low-end (≤11 GB RAM · CPU)',
      models: { learn: 'qwen3:1.7b', code: 'qwen2.5-coder:1.5b', max: 'qwen3:4b-q4_K_M', vision: 'gemma3:4b', '32k': 'qwen3:1.7b' },
      numCtx: 4096,
      numPredict: { learn: 2048, code: 2500, max: 3000, vision: 2048, '32k': 3000, codeplus: 2048 },
      fastGpu: false,
      ragBudget: 1500,
    },
    mid: {
      label: hasGpu ? `Mid-range (${vramGb} GB GPU · ${ramGb} GB RAM)` : `Mid-range (${ramGb} GB RAM · CPU)`,
      models: {
        learn: 'qwen3:4b-q4_K_M',
        code: vramGb >= 6 ? 'qwen2.5-coder:7b' : 'qwen2.5-coder:3b',
        max: 'qwen2.5-coder:7b',
        vision: 'gemma3:4b',
        '32k': 'qwen3:4b-q4_K_M',
      },
      numCtx: hasGpu ? 8192 : 4096,
      numPredict: { learn: 2500, code: 3500, max: 4096, vision: 2500, '32k': 3000, codeplus: 3000 },
      fastGpu: vramGb >= 6,
      ragBudget: hasGpu ? 2500 : 1800,
    },
    high: {
      label: hasGpu ? `High-end (${vramGb} GB GPU · ${ramGb} GB RAM)` : `High-RAM (${ramGb} GB RAM · CPU)`,
      models: { learn: 'qwen3:8b', code: 'qwen2.5-coder:7b', max: 'qwen3:14b', vision: 'gemma3:4b', '32k': 'qwen3:8b' },
      numCtx: hasGpu ? 12288 : 8192,
      numPredict: { learn: 4096, code: 4096, max: 6144, vision: 3000, '32k': 4096, codeplus: 4096 },
      fastGpu: hasGpu,
      ragBudget: 3000,
    },
    ultra: {
      label: `Ultra (${gpuName || `${vramGb} GB GPU`} · ${ramGb} GB RAM)`,
      models: {
        learn: 'qwen3:14b',
        code: 'qwen2.5-coder:14b',
        max: vramGb >= 22 || (unified && ramGb >= 36) ? 'qwen3:32b' : 'qwen3:14b',
        vision: vramGb >= 16 ? 'gemma3:12b' : 'gemma3:4b',
        '32k': 'qwen3:14b',
      },
      numCtx: 16384,
      numPredict: { learn: 6144, code: 6144, max: 8192, vision: 4096, '32k': 6144, codeplus: 6144 },
      fastGpu: true,
      ragBudget: 4000,
    },
  };

  const profile = profiles[tier];
  return {
    tier,
    ramGb,
    vramGb,
    gpuName,
    unified,
    hasGpu,
    logicalCores,
    physicalCores,
    cpuModel,
    numThread: hasGpu ? null : physicalCores, // let Ollama manage threads when offloading to GPU; pin physical cores on CPU
    ...profile,
  };
}

export const DEVICE = detectHardware();
