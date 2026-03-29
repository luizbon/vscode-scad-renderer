// A simple OpenSCAD script for testing the renderer
$fn = 60; // Smoothness parameter

difference() {
    // Outer cube
    cube([20, 20, 20], center = true);
    // Inner sphere cut-out
    sphere(r = 13);
}
