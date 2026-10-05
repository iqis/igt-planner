"""The TAKIBI Tarp Octa's flat pattern (web/tarp.js octa()), derived from its manual.

The manual (data/buffer/manuals/TP-430_manual_web.pdf, Snow Peak's public CDN) is VECTOR: page 5's plan
(上から見た図) is path 477 -- these are its exact control points (fitz get_drawings), not pixels.
That plan is the PITCHED tarp seen from above: along the ridge it is to scale (its pegs give the length
within 2.5% of the published 510), across it is foreshortened by the falling wings. So: along as drawn,
across stretched back to the published 450.

Also printed: what the drawing implies about the guyed footprint. Its across figure (750, published too)
is NOT reachable by a 450-wide cloth on 2 m ropes -- see the bound in tarp.js -- so only the along-ridge
numbers are a calibration target.
"""
cx, cy = 150.545, 391.94                     # centre of path 477 (pt)
M  = (92.79, 391.94)                         # main corner (pole tip)  -- apex of the 二又 V (path 480)
C3 = (91.09, 359.97)                         # 3m corner
C2 = (125.56, 347.98)                        # 2m corner
W  = (150.54, 349.28)                        # wing-centre (140 pole grommet)
ctl_C3C2 = [(113.57, 357.57)]                # bezier: C3,C3,(113.57,357.57),C2
ctl_C2W  = [(139.75, 349.28)]                # bezier: C2,C2,(139.75,349.28),W  -- (C2 -> W half of wing edge)
bbox_w = 210.00 - 91.09; bbox_h = 435.91 - 347.98
print("drawing bbox pt %.2f x %.2f  ratio %.3f   published 510x450 ratio %.3f" % (bbox_w, bbox_h, bbox_w/bbox_h, 510/450))
# pegs (paths 480/481/512): 二又+3m share a peg at x=45.33 / 255.75; 2m pegs at y=308.37 / 475.51
peg_w = 255.75 - 45.33; peg_h = 475.51 - 308.37
sx_peg, sy_peg = 8800/peg_w, 7500/peg_h
print("guyed-scale mm/pt: along %.1f  across %.1f" % (sx_peg, sy_peg))
print("  -> tarp length at peg scale %.0f mm (published 5100);  width %.0f mm (published 4500)" % (bbox_w*sx_peg, bbox_h*sy_peg))
import math
print("  -> across-ridge foreshortening %.3f = cos %.1f deg (wing slope in plan view)" % (bbox_h*sy_peg/4500, math.degrees(math.acos(bbox_h*sy_peg/4500))))
sx, sy = 5100/bbox_w, 4500/bbox_h            # flat: along from the drawing, across stretched to the published 450
mm = lambda p: (round((p[0]-cx)*sx), round((p[1]-cy)*sy))
out = {k: mm(v) for k, v in dict(M=M, C3=C3, C2=C2, W=W).items()}
print("flat (half-plane, x along ridge, y across), mm:", out)
edge = lambda a, b: math.dist(mm(a), mm(b))
print("edges mm: end M-C3 %.0f  C3-C2 %.0f  C2-W %.0f   ridge M-M %.0f" % (edge(M, C3), edge(C3, C2), edge(C2, W), 2*abs(out['M'][0])))
# concave depth of each curved edge (bezier midpoint vs chord), flat mm
def bez_mid(p0, c, p3):  # cubic with p1=p0, p2=c
    return tuple((4*p0[i] + 3*c[i] + p3[i]) / 8 for i in (0, 1))
for name, (a, c, b) in {"C3-C2": (C3, ctl_C3C2[0], C2), "C2-W": (C2, ctl_C2W[0], W)}.items():
    m = mm(bez_mid(a, c, b)); A, B = mm(a), mm(b)
    ch = ((A[0]+B[0])/2, (A[1]+B[1])/2); L = math.dist(A, B)
    nx, ny = -(B[1]-A[1])/L, (B[0]-A[0])/L
    d = (m[0]-ch[0])*nx + (m[1]-ch[1])*ny
    print("  %s chord %.0f mm, cut in %.0f mm = %.1f%%" % (name, L, abs(d), 100*abs(d)/L))
end_notch = abs(out['C3'][0]) - abs(out['M'][0])
print("  end edge: main corner set in %d mm from the 3m corners (a shallow V over %d mm)" % (end_notch, 2*abs(out['C3'][1])))
