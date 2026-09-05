import {
  BackSide, DataTexture, DoubleSide, FrontSide, RGBAFormat, ShaderMaterial,
  Texture, Vector3, Vector4,
} from 'three'
import type { LoadedBody, RingBand } from './assets'

const white = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat)
white.needsUpdate = true

const vertexShader = `
#include <common>
attribute vec3 sourcePosition;
varying vec3 vLocal;
varying vec3 vNormalLocal;
varying vec2 vUv;
#include <logdepthbuf_pars_vertex>
void main() {
  vLocal = sourcePosition;
  vNormalLocal = normal;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`

const common = `
varying vec3 vLocal;
varying vec3 vNormalLocal;
varying vec2 vUv;
uniform vec3 uSun;
uniform vec3 uEye;
uniform float uFlux;
uniform float uExposure;
uniform float uRadiusKm;
uniform vec3 uAxes;
uniform vec4 uOccluders[4];
uniform vec3 uRingNormal;
uniform vec3 uBands[16];
uniform int uBandCount;
float sphereShadow(vec3 p, vec3 center, float radius) {
  vec3 offset = center - p;
  float t = dot(offset, uSun);
  return t > 0.0 && dot(offset, offset) - t*t < radius*radius ? 0.0 : 1.0;
}
float eclipse(vec3 p) {
  float light = 1.0;
  for (int i = 0; i < 4; i++) {
    if (uOccluders[i].w > 0.0) light *= sphereShadow(p, uOccluders[i].xyz, uOccluders[i].w);
  }
  return light;
}
float ringTransmission(vec3 p) {
  float slope = dot(uSun, uRingNormal);
  if (abs(slope) < 1e-7) return 1.0;
  float t = -dot(p, uRingNormal) / slope;
  if (t <= 0.0) return 1.0;
  float r = length(p + t * uSun);
  float tau = 0.0;
  for (int i = 0; i < 16; i++) {
    if (i < uBandCount && r >= uBands[i].x && r <= uBands[i].y) tau += uBands[i].z;
  }
  return exp(-tau / max(abs(slope), 1e-6));
}
float opacity(float tau, float incidence) {
  float x = tau / max(abs(incidence), 1e-6);
  return x < 0.001 ? x * (1.0 - x * 0.5) : 1.0 - exp(-x);
}
#include <logdepthbuf_pars_fragment>
`

const surfaceFragment = `
${common}
uniform sampler2D uColor;
uniform sampler2D uRoughnessMap;
uniform sampler2D uNight;
uniform sampler2D uOcean;
uniform sampler2D uHeight;
uniform vec3 uAlbedoTint;
uniform float uRoughness;
uniform bool uHasRoughness;
uniform bool uHasHeight;
uniform bool uEarth;
uniform bool uSunBody;
void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vNormalLocal);
  vec3 eye = normalize(uEye - vLocal);
  if (uHasHeight) {
    float h = texture2D(uHeight, vUv).r / uRadiusKm;
    vec3 dp1 = dFdx(vLocal), dp2 = dFdy(vLocal);
    vec3 r1 = cross(dp2, n), r2 = cross(n, dp1);
    float det = dot(dp1, r1);
    n = normalize(abs(det) * n - sign(det) * (dFdx(h)*r1 + dFdy(h)*r2));
  }
  vec3 albedo = texture2D(uColor, vUv).rgb * uAlbedoTint;
  float mu = dot(n, uSun);
  float nv = max(dot(n, eye), 0.001);
  vec3 radiance;
  if (uSunBody) {
    radiance = 2.0 * albedo * (0.4 + 0.6 * nv);
  } else {
    float rough = uHasRoughness ? texture2D(uRoughnessMap, vUv).r : uRoughness;
    float sigma2 = rough*rough;
    float a = 1.0 - 0.5*sigma2/(sigma2+0.33);
    float b = 0.45*sigma2/(sigma2+0.09);
    float st = sqrt(max(0.0, 1.0-mu*mu));
    float sv = sqrt(max(0.0, 1.0-nv*nv));
    float azimuth = max(0.0, (dot(uSun,eye)-mu*nv)/max(st*sv,0.001));
    float oren = (a + b*azimuth*st*sv/max(max(mu,nv),0.001))/a;
    float light = eclipse(vLocal) * ringTransmission(vLocal);
    radiance = albedo * max(0.0, mu) * oren * uFlux * light;
    if (uEarth) {
      float ocean = texture2D(uOcean, vUv).r;
      vec3 halfVector = normalize(uSun + eye);
      float nh = max(dot(n, halfVector), 0.0);
      float vh = max(dot(eye, halfVector), 0.0);
      float a2 = 0.012;
      float denom = nh*nh*(a2-1.0)+1.0;
      float distribution = a2 / (3.14159265*denom*denom);
      float fresnel = 0.02 + 0.98*pow(1.0-vh,5.0);
      float k = 0.12;
      float geometry = nv/(nv*(1.0-k)+k) * max(mu,0.0)/(max(mu,0.0)*(1.0-k)+k);
      radiance += vec3(ocean * distribution*fresnel*geometry/max(4.0*nv,0.001)) * uFlux * light;
      radiance += 0.035 * texture2D(uNight, vUv).rgb * (1.0-smoothstep(-0.15,-0.035,mu));
    }
  }
  gl_FragColor = vec4(radiance * uExposure, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

const shellFragment = `
${common}
uniform sampler2D uColor;
uniform sampler2D uCloud;
uniform vec3 uTau;
uniform float uScaleHeightKm;
uniform bool uCloudShell;
uniform bool uVenus;
void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vNormalLocal);
  vec3 eye = normalize(uEye-vLocal);
  float mu = dot(n,uSun);
  float lit = max(mu,0.0)*eclipse(vLocal);
  vec3 color;
  float alpha;
  if (uCloudShell) {
    alpha = uVenus ? 1.0 : smoothstep(0.18,0.82,texture2D(uCloud,vUv).r);
    color = uVenus ? texture2D(uColor,vUv).rgb : vec3(0.93,0.95,0.98);
    if (!uVenus) alpha *= smoothstep(0.0,0.08,mu);
  } else {
    float tangent = 1.0 / sqrt(max(0.00001,pow(dot(n,eye),2.0)+uScaleHeightKm/uRadiusKm));
    vec3 optical = vec3(1.0) - exp(-uTau * tangent * 0.12);
    color = optical / max(max(optical.r,optical.g),max(optical.b,0.00001));
    alpha = max(max(optical.r,optical.g),optical.b) * smoothstep(0.0,0.08,mu);
  }
  gl_FragColor = vec4(color * lit * uFlux * uExposure, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

const ringFragment = `
${common}
uniform float uOpticalDepth;
uniform vec3 uRingColor;
void main() {
  #include <logdepthbuf_fragment>
  vec3 eye = normalize(uEye-vLocal);
  vec3 n = vec3(0.0,0.0,1.0);
  float alpha = opacity(uOpticalDepth,dot(n,eye));
  vec3 axisPoint = vLocal/uAxes;
  vec3 axisSun = normalize(uSun/uAxes);
  float t = dot(-axisPoint,axisSun);
  float parentLight = t > 0.0 && length(axisPoint+axisSun*t)<1.0 ? 0.0 : 1.0;
  float variation = 0.96 + 0.04*sin(vUv.y*503.0)*sin(vUv.y*97.0);
  float radiance = abs(dot(n,uSun)) * uFlux * uExposure * parentLight * eclipse(vLocal);
  gl_FragColor = vec4(uRingColor * variation * radiance,alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

export function materialUniforms(asset: LoadedBody): ShaderMaterial['uniforms'] {
  const r = asset.record
  return {
    uSun: { value: new Vector3(1, 0, 0) }, uEye: { value: new Vector3(0, 0, 5) },
    uFlux: { value: 1 }, uExposure: { value: 1 }, uRadiusKm: { value: r.normalization_radius_km },
    uAxes: { value: new Vector3(...r.radii_km).divideScalar(r.normalization_radius_km) },
    uOccluders: { value: Array.from({ length: 4 }, () => new Vector4()) },
    uRingNormal: { value: new Vector3(0, 0, 1) },
    uBands: { value: Array.from({ length: 16 }, () => new Vector3()) }, uBandCount: { value: 0 },
    uColor: { value: asset.textures.color ?? white }, uRoughnessMap: { value: asset.textures.roughness ?? white },
    uAlbedoTint: { value: new Vector3(1, 1, 1) },
    uNight: { value: asset.textures.night ?? white }, uOcean: { value: asset.textures.ocean_mask ?? white },
    uHeight: { value: asset.textures.height ?? white }, uHasHeight: { value: Boolean(asset.textures.height) },
    uHasRoughness: { value: Boolean(asset.textures.roughness) }, uRoughness: { value: r.roughness },
    uEarth: { value: asset.id === 'earth' }, uSunBody: { value: asset.id === 'sun' },
    uCloud: { value: asset.textures.clouds ?? white },
    uTau: { value: new Vector3(...(r.atmosphere_optical_depth_rgb ?? [0, 0, 0])) },
    uScaleHeightKm: { value: r.atmosphere_scale_height_km ?? 1 },
    uCloudShell: { value: false }, uVenus: { value: asset.id === 'venus' },
  }
}

export function surfaceMaterial(asset: LoadedBody): ShaderMaterial {
  const uniforms = materialUniforms(asset)
  if (asset.id === 'venus') {
    uniforms.uColor!.value = white
    uniforms.uAlbedoTint!.value.set(.18, .18, .18)
    uniforms.uHasRoughness!.value = false
    uniforms.uRoughness!.value = .95
  }
  const material = new ShaderMaterial({ vertexShader, fragmentShader: surfaceFragment, uniforms })
  if (asset.id === 'venus') material.userData.appearance = 'Reconstructed neutral ground. The observed Venus map belongs to its cloud shell.'
  return material
}

export function terrainMaterial(asset: LoadedBody): ShaderMaterial {
  const material = surfaceMaterial(asset)
  material.uniforms.uHasHeight!.value = false
  material.polygonOffset = true
  material.polygonOffsetFactor = -1
  material.polygonOffsetUnits = -1
  return material
}

export function shellMaterial(asset: LoadedBody, cloud: boolean): ShaderMaterial {
  const uniforms = materialUniforms(asset)
  uniforms.uCloudShell!.value = cloud
  return new ShaderMaterial({ vertexShader, fragmentShader: shellFragment, uniforms,
    transparent: !cloud || asset.id !== 'venus', depthWrite: cloud && asset.id === 'venus',
    side: cloud ? FrontSide : DoubleSide })
}

const ringColors: Record<string, [number, number, number]> = {
  saturn: [.54, .47, .36], jupiter: [.09, .065, .04], uranus: [.085, .080, .075],
  neptune: [.07, .06, .05], chariklo: [.17, .16, .14], haumea: [.15, .13, .11], quaoar: [.12, .10, .08],
}
export function ringMaterial(asset: LoadedBody, band: RingBand): ShaderMaterial {
  return new ShaderMaterial({ vertexShader, fragmentShader: ringFragment,
    uniforms: { ...materialUniforms(asset), uOpticalDepth: { value: band.optical_depth },
      uRingColor: { value: new Vector3(...(ringColors[asset.id] ?? [.2, .18, .15])) } },
    side: DoubleSide, transparent: true, depthWrite: false })
}

export function disposeFallbackTextures(): void { white.dispose() }
export function fallbackTexture(): Texture { return white }
export const atmosphereInteriorSide = BackSide
