export function addTriangle(geometry, triangle, maxTriangles = 60) {
  if (geometry.triangles.length >= maxTriangles) return false;
  geometry.triangles.push(triangle);
  return true;
}

export function removeTriangle(geometry, triangleId) {
  const nextTriangles = geometry.triangles.filter((triangle) => triangle.id !== triangleId);
  if (nextTriangles.length === geometry.triangles.length) return false;
  geometry.triangles = nextTriangles;
  return true;
}
