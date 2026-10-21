// Nodes as discs with a soft glow around them (drawn by WebGL, like sigma's
// own circles but on a bigger triangle so the glow fits). Only the disc
// itself reacts to the mouse.
import type { Attributes } from "graphology-types";
import { NodeCircleProgram } from "sigma/rendering";

const VERTEX = /*glsl*/ `
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_position;
attribute float a_size;
attribute float a_angle;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_correctionRatio;

varying vec4 v_color;
varying vec2 v_diffVector;
varying float v_radius;

const float bias = 255.0 / 254.0;

void main() {
  // Twice sigma's triangle: the disc keeps its size, the glow goes around it.
  float size = a_size * u_correctionRatio / u_sizeRatio * 8.0;
  vec2 diffVector = size * vec2(cos(a_angle), sin(a_angle));
  gl_Position = vec4((u_matrix * vec3(a_position + diffVector, 1)).xy, 0, 1);
  v_diffVector = diffVector;
  v_radius = size / 4.0;
  #ifdef PICKING_MODE
  v_color = a_id;
  #else
  v_color = a_color;
  #endif
  v_color.a *= bias;
}
`;

const FRAGMENT = /*glsl*/ `
precision highp float;

varying vec4 v_color;
varying vec2 v_diffVector;
varying float v_radius;

uniform float u_correctionRatio;

void main(void) {
  float d = length(v_diffVector);
  #ifdef PICKING_MODE
  gl_FragColor = d > v_radius ? vec4(0.0) : v_color;
  #else
  float edge = u_correctionRatio * 2.0;
  float disc = 1.0 - smoothstep(v_radius - edge, v_radius, d);
  float glow = 1.0 - smoothstep(v_radius, v_radius * 2.0, d);
  float a = max(disc, glow * glow * 0.32) * v_color.a;
  // sigma blends premultiplied colours.
  gl_FragColor = vec4(v_color.rgb * a, a);
  #endif
}
`;

export class NodeGlowProgram<N extends Attributes = Attributes, E extends Attributes = Attributes, G extends Attributes = Attributes> extends NodeCircleProgram<N, E, G> {
  getDefinition() {
    return { ...super.getDefinition(), VERTEX_SHADER_SOURCE: VERTEX, FRAGMENT_SHADER_SOURCE: FRAGMENT };
  }
}
