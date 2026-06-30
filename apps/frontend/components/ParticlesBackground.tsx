"use client";

import { useEffect, useRef } from "react";
import { Renderer, Camera, Geometry, Program, Mesh, Vec3 } from "ogl";

const vertex = /* glsl */ `
  attribute vec3 position;
  attribute vec4 random;
  attribute vec3 color;

  uniform mat4 modelMatrix;
  uniform mat4 viewMatrix;
  uniform mat4 projectionMatrix;
  uniform float uTime;
  uniform float uSpread;
  uniform float uBaseSize;
  uniform float uSizeRandomness;

  varying vec4 vRandom;
  varying vec3 vColor;

  void main() {
    vRandom = random;
    vColor = color;

    vec3 pos = position * uSpread;
    pos.z *= 10.0;

    vec4 mPos = modelMatrix * vec4(pos, 1.0);
    float t = uTime;
    mPos.x += sin(t * random.z + 6.28 * random.w) * mix(0.1, 1.5, random.x);
    mPos.y += sin(t * random.y + 6.28 * random.x) * mix(0.1, 1.5, random.w);
    mPos.z += sin(t * random.w + 6.28 * random.y) * mix(0.1, 1.5, random.z);

    vec4 mvPos = viewMatrix * mPos;
    gl_PointSize = (uBaseSize * (1.0 + uSizeRandomness * (random.x - 0.5))) / length(mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const fragment = /* glsl */ `
  precision highp float;

  uniform float uTime;
  varying vec4 vRandom;
  varying vec3 vColor;

  void main() {
    vec2 uv = gl_PointCoord.xy;
    float d = length(uv - vec2(0.5));
    float circle = smoothstep(0.5, 0.35, d) * 0.75;
    gl_FragColor = vec4(vColor + 0.12 * sin(uv.yxx + uTime + vRandom.y * 6.28), circle);
  }
`;

interface ParticlesBackgroundProps {
  particleCount?: number;
  particleSpread?: number;
  speed?: number;
  particleColors?: string[];
  moveParticlesOnHover?: boolean;
  particleHoverFactor?: number;
  particleBaseSize?: number;
  sizeRandomness?: number;
  cameraDistance?: number;
  disableRotation?: boolean;
  className?: string;
}

const hexToRgb = (hex: string): [number, number, number] => {
  hex = hex.replace(/^#/, "");
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const int = parseInt(hex, 16);
  return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255];
};

export default function ParticlesBackground({
  particleCount = 800,
  particleSpread = 12,
  speed = 0.06,
  particleColors = ["#1a1a1a", "#333333", "#555555", "#888888"],
  moveParticlesOnHover = true,
  particleHoverFactor = 0.4,
  particleBaseSize = 100,
  sizeRandomness = 1.2,
  cameraDistance = 20,
  disableRotation = false,
  className = "",
}: ParticlesBackgroundProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new Renderer({ depth: false, alpha: true, antialias: true });
    const gl = renderer.gl;
    gl.clearColor(1, 1, 1, 0);

    let width = container.offsetWidth;
    let height = container.offsetHeight;

    const camera = new Camera(gl, { fov: 15 });
    camera.position.set(0, 0, cameraDistance);

    const resize = () => {
      width = container.offsetWidth;
      height = container.offsetHeight;
      renderer.setSize(width, height);
      camera.perspective({ aspect: width / height });
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    gl.canvas.style.position = "absolute";
    gl.canvas.style.inset = "0";
    gl.canvas.style.width = "100%";
    gl.canvas.style.height = "100%";
    container.appendChild(gl.canvas);

    const count = particleCount;
    const positions = new Float32Array(count * 3);
    const randoms = new Float32Array(count * 4);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      positions.set([Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1], i * 3);
      randoms.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
      // Use dark colors for white background
      const col = hexToRgb(particleColors[Math.floor(Math.random() * particleColors.length)]);
      colors.set(col, i * 3);
    }

    const geometry = new Geometry(gl, {
      position: { size: 3, data: positions },
      random: { size: 4, data: randoms },
      color: { size: 3, data: colors },
    });

    const program = new Program(gl, {
      vertex,
      fragment,
      uniforms: {
        uTime: { value: 0 },
        uSpread: { value: particleSpread },
        uBaseSize: { value: particleBaseSize },
        uSizeRandomness: { value: sizeRandomness },
      },
      transparent: true,
      depthTest: false,
    });

    const mesh = new Mesh(gl, { mode: gl.POINTS, geometry, program });

    let mouseX = 0;
    let mouseY = 0;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      mouseX = ((e.clientX - rect.left) / width - 0.5) * particleHoverFactor;
      mouseY = -((e.clientY - rect.top) / height - 0.5) * particleHoverFactor;
    };

    if (moveParticlesOnHover) {
      container.addEventListener("mousemove", handleMouseMove);
    }

    let animId: number;
    const update = (t: number) => {
      animId = requestAnimationFrame(update);
      program.uniforms.uTime.value = t * 0.001 * speed * 10;

      if (!disableRotation) {
        mesh.rotation.x += 0.0002;
        mesh.rotation.y += 0.0003;
      }

      if (moveParticlesOnHover) {
        camera.position.x += (mouseX - camera.position.x) * 0.04;
        camera.position.y += (mouseY - camera.position.y) * 0.04;
        camera.lookAt(new Vec3(0, 0, 0));
      }

      renderer.render({ scene: mesh, camera });
    };

    animId = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();
      if (moveParticlesOnHover) container.removeEventListener("mousemove", handleMouseMove);
      if (container.contains(gl.canvas)) container.removeChild(gl.canvas);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 z-0 overflow-hidden bg-white ${className}`}
      style={{ width: "100%", height: "100%", position: "absolute" }}
    />
  );
}
