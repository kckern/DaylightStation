// SYNTHETIC STUB for unit tests: the real crt-geom shader (GPL-2.0+) is installed to
// media/vendor/shaders/crt/ by `npm run install:assets`. Only the parameter table is mirrored.
#pragma parameter CRTgamma "CRTGeom Target Gamma" 2.4 0.1 5.0 0.1
#pragma parameter INV "Inverse Gamma/CRT-Geom Gamma out" 0.0 0.0 1.0 1.0
#pragma parameter monitorgamma "CRTGeom Monitor Gamma" 2.2 0.1 5.0 0.1
#pragma parameter d "CRTGeom Distance" 1.6 0.1 3.0 0.1
#pragma parameter CURVATURE "CRTGeom Curvature Toggle" 1.0 0.0 1.0 1.0
#pragma parameter R "CRTGeom Curvature Radius" 2.0 0.1 10.0 0.1
#pragma parameter cornersize "CRTGeom Corner Size" 0.03 0.001 1.0 0.005
#pragma parameter cornersmooth "CRTGeom Corner Smoothness" 1000.0 80.0 2000.0 100.0
#pragma parameter x_tilt "CRTGeom Horizontal Tilt" 0.0 -0.5 0.5 0.05
#pragma parameter y_tilt "CRTGeom Vertical Tilt" 0.0 -0.5 0.5 0.05
#pragma parameter overscan_x "CRTGeom Horiz. Overscan %" 100.0 -125.0 125.0 1.0
#pragma parameter overscan_y "CRTGeom Vert. Overscan %" 100.0 -125.0 125.0 1.0
#pragma parameter DOTMASK "CRTGeom Dot Mask Strength" 0.3 0.0 1.0 0.1
#pragma parameter SHARPER "CRTGeom Sharpness" 1.0 1.0 3.0 1.0
#pragma parameter scanline_weight "CRTGeom Scanline Weight" 0.3 0.1 0.5 0.05
#pragma parameter lum "CRTGeom Luminance" 0.0 0.0 1.0 0.01
#pragma parameter interlace_detect "CRTGeom Interlacing Simulation" 1.0 0.0 1.0 1.0
#pragma parameter SATURATION "CRTGeom Saturation" 1.0 0.0 2.0 0.05
#if defined(VERTEX)
attribute vec4 VertexCoord;
void main(){ gl_Position = VertexCoord; }
#elif defined(FRAGMENT)
precision highp float;
void main(){ gl_FragColor = vec4(0.0); }
#endif
