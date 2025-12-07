const isBrowser = typeof window !== 'undefined';

const vertexShaderSource = `
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
  v_uv = (a_position + 1.0) * 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const fragmentShaderSource = `
precision mediump float;

varying vec2 v_uv;
uniform sampler2D u_texture;
uniform vec2 u_resolution;

vec2 barrel(vec2 uv) {
  uv = uv * 2.0 - 1.0;
  float r2 = dot(uv, uv);
  uv *= 1.0 + 0.08 * r2;
  return uv * 0.5 + 0.5;
}

void main() {
  vec2 uv = barrel(v_uv);

  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec2 px = 1.25 / u_resolution;
  vec3 color;

  float scan = sin((uv.y * u_resolution.y) * 3.14159) * 0.04;
  vec2 uvR = uv + vec2(px.x, scan * px.y);
  vec2 uvB = uv - vec2(px.x, scan * px.y);

  float vignette = smoothstep(0.85, 0.35, length(uv - 0.5));

  color.r = texture2D(u_texture, uvR).r;
  color.g = texture2D(u_texture, uv).g;
  color.b = texture2D(u_texture, uvB).b;

  color *= 1.02 + scan * 0.5;
  color *= mix(1.0, vignette, 0.35);
  color = clamp(color, 0.0, 1.0);

  gl_FragColor = vec4(color, 1.0);
}
`;

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const vertex = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

class CrtWebGLRenderer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.gl = this.canvas.getContext('webgl', {
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    }) || this.canvas.getContext('experimental-webgl');

    if (!this.gl) {
      this.failed = true;
      return;
    }

    this.program = createProgram(this.gl, vertexShaderSource, fragmentShaderSource);
    if (!this.program) {
      this.failed = true;
      return;
    }

    this.positionLocation = this.gl.getAttribLocation(this.program, 'a_position');
    this.textureLocation = this.gl.getUniformLocation(this.program, 'u_texture');
    this.resolutionLocation = this.gl.getUniformLocation(this.program, 'u_resolution');

    this.buffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
    this.gl.bufferData(
      this.gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1,
        1, -1,
        -1, 1,
        -1, 1,
        1, -1,
        1, 1,
      ]),
      this.gl.STATIC_DRAW,
    );

    this.texture = this.gl.createTexture();
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, true);
  }

  render(video, width, height) {
    if (this.failed || !this.gl || !this.program) return null;
    if (!width || !height) return null;

    const gl = this.gl;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.uniform1i(this.textureLocation, 0);
    gl.uniform2f(this.resolutionLocation, width, height);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return this.canvas;
  }
}

let cachedCrtRenderer = null;

function getCrtRenderer() {
  if (!isBrowser) return null;
  if (cachedCrtRenderer === false) return null;
  if (cachedCrtRenderer instanceof CrtWebGLRenderer && !cachedCrtRenderer.failed) {
    return cachedCrtRenderer;
  }
  try {
    cachedCrtRenderer = new CrtWebGLRenderer();
    if (cachedCrtRenderer.failed) {
      cachedCrtRenderer = false;
      return null;
    }
    return cachedCrtRenderer;
  } catch (err) {
    cachedCrtRenderer = false;
    return null;
  }
}

const applyCrt2d = (ctx, video, width, height) => {
  ctx.filter = 'contrast(1.05) saturate(1.1) brightness(0.98)';
  ctx.drawImage(video, 0, 0, width, height);
  ctx.filter = 'none';

  const lineHeight = 2;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
  for (let y = 0; y < height; y += lineHeight * 2) {
    ctx.fillRect(0, y, width, lineHeight);
  }

  const gradient = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) / 3,
    width / 2,
    height / 2,
    Math.max(width, height) / 1.05,
  );
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const offset = Math.max(1, Math.floor(Math.min(width, height) * 0.0025));
  ctx.globalCompositeOperation = 'screen';
  ctx.drawImage(video, offset, 0, width, height);
  ctx.fillStyle = 'rgba(218, 49, 49, 0.08)';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(video, 0, offset, width, height);
  ctx.fillStyle = 'rgba(40, 129, 206, 0.08)';
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';
};

export const webcamFilters = {
  none: {
    id: 'none',
    label: 'None',
    css: 'none',
    apply: (ctx, video, width, height) => {
      ctx.drawImage(video, 0, 0, width, height);
    },
  },
  grayscale: {
    id: 'grayscale',
    label: 'Grayscale',
    css: 'grayscale(1)',
    apply: (ctx, video, width, height) => {
      ctx.filter = 'grayscale(1)';
      ctx.drawImage(video, 0, 0, width, height);
      ctx.filter = 'none';
    },
  },
  softBlur: {
    id: 'softBlur',
    label: 'Soft Blur',
    css: 'blur(2px) saturate(1.05)',
    apply: (ctx, video, width, height) => {
      ctx.filter = 'blur(2px) saturate(1.05)';
      ctx.drawImage(video, 0, 0, width, height);
      ctx.filter = 'none';
    },
  },
  punchy: {
    id: 'punchy',
    label: 'Punchy',
    css: 'contrast(1.1) saturate(1.15) brightness(1.02)',
    apply: (ctx, video, width, height) => {
      ctx.filter = 'contrast(1.1) saturate(1.15) brightness(1.02)';
      ctx.drawImage(video, 0, 0, width, height);
      ctx.filter = 'none';
    },
  },
  crt: {
    id: 'crt',
    label: 'CRT',
    css: 'contrast(1.02) saturate(1.08) brightness(0.98)',
    apply: (ctx, video, width, height) => {
      try {
        const renderer = getCrtRenderer();
        const output = renderer?.render(video, width, height);
        if (output) {
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(output, 0, 0, width, height);
          return;
        }
      } catch (err) {
        // Fall through to 2D path when WebGL is unavailable or fails
      }

      applyCrt2d(ctx, video, width, height);
    },
  },
  vignette: {
    id: 'vignette',
    label: 'Vignette',
    css: 'none',
    apply: (ctx, video, width, height) => {
      ctx.drawImage(video, 0, 0, width, height);
      const gradient = ctx.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) / 3,
        width / 2,
        height / 2,
        Math.max(width, height) / 1.2,
      );
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    },
  },
};

export function getWebcamFilter(id) {
  if (!id) return webcamFilters.crt;
  return webcamFilters[id] || webcamFilters.crt;
}
