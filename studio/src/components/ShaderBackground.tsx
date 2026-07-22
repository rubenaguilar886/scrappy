import { useEffect, useRef } from 'react'

/* ─── Vertex shader: fullscreen quad ─── */
const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`

/* ─── Fragment shader: Swirl + ChromaFlow + FlutedGlass + FilmGrain ─── */
const FRAG = `
precision highp float;
uniform vec2  u_res;
uniform float u_time;

/* ── Gradient noise helpers ── */
vec2 _h2(vec2 p){
  p = vec2(dot(p, vec2(127.1,311.7)), dot(p, vec2(269.5,183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453);
}
float _gn(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(
    mix(dot(_h2(i),          f          ), dot(_h2(i+vec2(1,0)), f-vec2(1,0)), u.x),
    mix(dot(_h2(i+vec2(0,1)), f-vec2(0,1)), dot(_h2(i+vec2(1,1)), f-vec2(1,1)), u.x),
    u.y
  );
}

/* ── Fractional Brownian Motion (Swirl core) ── */
float fbm(vec2 p){
  float v = 0.0; float a = 0.5;
  for(int i=0;i<5;i++){ v += a*_gn(p); p = p*2.0+vec2(1.7,9.2); a *= 0.5; }
  return v;
}

/* ── Cheap hash for film grain ── */
float _gr(vec2 uv, float t){
  return fract(sin(dot(floor(uv*900.0+t*150.0), vec2(127.1,311.7)))*43758.5453)*2.0-1.0;
}

void main(){
  vec2 uv  = gl_FragCoord.xy / u_res;
  float ar = u_res.x / u_res.y;
  float t  = u_time * 0.07;

  /* ── SWIRL (domain-warped fbm — colorA: #fff, colorB: #f0f0f0) ── */
  vec2 p = (uv - 0.5) * vec2(ar, 1.0);
  vec2 q = vec2(fbm(p              + t),
                fbm(p + vec2(5.2,1.3) + t*0.9));
  vec2 r = vec2(fbm(p + 4.0*q + vec2(1.7,9.2) + t*0.5),
                fbm(p + 4.0*q + vec2(8.3,2.8) + t*0.6));
  float f = fbm(p + 4.0*r);

  /* Swirl palette: white ↔ #f0f0f0 */
  vec3 cA = vec3(1.000);          /* colorA: white     */
  vec3 cB = vec3(0.941);          /* colorB: #f0f0f0   */
  vec3 col = mix(cA, cB, clamp(f*0.5+0.5, 0.0, 1.0));

  /* ── CHROMAFLOW (baseColor: #fff, accent: #7C3AED purple + #22D3EE cyan) ── */
  /* Momentum 13, radius 3.5 → strong directional spread */
  float len   = length(p);
  float rNorm = smoothstep(0.0, 0.5, len * 1.4);      /* radius fade   */
  vec2  dn    = len > 0.001 ? normalize(p) : vec2(0.0);

  float upF    = max(0.0, -dn.y) * rNorm;
  float rightF = max(0.0,  dn.x) * rNorm;
  float downF  = max(0.0,  dn.y) * rNorm;
  float leftF  = max(0.0, -dn.x) * rNorm;

  /* animated flow (momentum) */
  float mFlow = sin(u_time * 0.09) * 0.5 + 0.5;

  vec3 purple = vec3(0.482, 0.227, 0.929);  /* #7C3AED */
  vec3 cyan   = vec3(0.133, 0.827, 0.933);  /* #22D3EE */
  vec3 pink   = vec3(0.925, 0.282, 0.600);  /* #EC4899 */

  float strength = (f*0.5+0.5) * 0.12 * mFlow;
  col = mix(col, purple, upF    * strength * 1.3);
  col = mix(col, cyan,   rightF * strength * 1.0);
  col = mix(col, purple, leftF  * strength * 1.1);
  col = mix(col, pink,   downF  * strength * 0.7);

  /* ── FLUTED GLASS (freq 8, aberration 0.61, highlight 0.12) ── */
  float freq = 8.0;
  /* Two-layer ribs (slight angle: 31°) */
  float ang  = radians(31.0);
  vec2  ribDir = vec2(cos(ang), sin(ang));
  float proj   = dot(uv, ribDir);
  float rib    = sin(proj * freq * 6.28318 + u_time * 0.15) * 0.5 + 0.5;
  /* Highlight on ribbing surface */
  col += rib * 0.12 * (cA - col) * (1.0 - rNorm * 0.6);

  /* Chromatic aberration from FlutedGlass (aberration: 0.61) */
  float aberr = 0.0061;
  vec2  aberrUV = uv + vec2(rib * aberr, 0.0);
  float ribR = sin(dot(aberrUV, ribDir) * freq * 6.28318 + u_time * 0.15) * 0.5 + 0.5;
  /* subtle RGB split */
  col.r = mix(col.r, col.r + ribR * 0.012, 0.5);
  col.b = mix(col.b, col.b - rib  * 0.008, 0.5);

  /* ── FILM GRAIN (strength 0.05) ── */
  col += _gr(uv, u_time) * 0.025;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`

export default function ShaderBackground() {
  const cvs  = useRef<HTMLCanvasElement>(null)
  const rafR = useRef<number>(0)

  useEffect(() => {
    const canvas = cvs.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false })
    if (!gl) return

    /* ── compile helper ── */
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        console.error(gl.getShaderInfoLog(s))
      return s
    }

    const prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl.VERTEX_SHADER,   VERT))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    gl.useProgram(prog)

    /* fullscreen quad */
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER,
      new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(prog, 'a_pos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

    const uRes  = gl.getUniformLocation(prog, 'u_res')
    const uTime = gl.getUniformLocation(prog, 'u_time')

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio, 1.5) /* cap DPR for perf */
      canvas.width  = canvas.offsetWidth  * dpr
      canvas.height = canvas.offsetHeight * dpr
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.uniform2f(uRes, canvas.width, canvas.height)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const t0 = performance.now()
    const frame = () => {
      gl.uniform1f(uTime, (performance.now() - t0) * 0.001)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      rafR.current = requestAnimationFrame(frame)
    }
    frame()

    return () => {
      ro.disconnect()
      cancelAnimationFrame(rafR.current)
      gl.deleteProgram(prog)
    }
  }, [])

  return (
    <canvas
      ref={cvs}
      className="absolute inset-0 w-full h-full"
      style={{ zIndex: 10, pointerEvents: 'none' }}
      aria-hidden="true"
    />
  )
}
