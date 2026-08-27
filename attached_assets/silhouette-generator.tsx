import React, { useState, useRef, useEffect } from 'react';
import { Upload, Camera } from 'lucide-react';

const SilhouetteGenerator = () => {
  const [originalImage, setOriginalImage] = useState(null);
  const [svgPoints, setSvgPoints] = useState([]);
  const [selectedPointIndex, setSelectedPointIndex] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 600, height: 400 });
  const [threshold, setThreshold] = useState(50);
  
  const canvasRef = useRef(null);
  const svgRef = useRef(null);
  
  const handleImageUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // Calculate aspect ratio and resize canvas
        const aspectRatio = img.width / img.height;
        const newHeight = Math.min(400, img.height);
        const newWidth = newHeight * aspectRatio;
        setCanvasSize({ width: newWidth, height: newHeight });
        
        setOriginalImage(img);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  };
  
  const detectEdges = () => {
    if (!originalImage || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    // Draw original image
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(originalImage, 0, 0, canvas.width, canvas.height);
    
    // Get image data for processing
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    // Simple edge detection using a sobel operator approximation
    const edges = detectEdgesFromImageData(data, canvas.width, canvas.height, threshold);
    
    // Convert edge points to SVG path
    const pathPoints = simplifyPoints(edges, 5);
    setSvgPoints(pathPoints);
  };
  
  const detectEdgesFromImageData = (imageData, width, height, threshold) => {
    // Convert to grayscale and detect edges using simple gradient
    const grayscale = new Array(width * height);
    for (let i = 0; i < height; i++) {
      for (let j = 0; j < width; j++) {
        const idx = (i * width + j) * 4;
        grayscale[i * width + j] = 
          (imageData[idx] * 0.3 + imageData[idx + 1] * 0.59 + imageData[idx + 2] * 0.11);
      }
    }
    
    // Find edge points using gradient magnitude
    const edges = [];
    for (let i = 1; i < height - 1; i++) {
      for (let j = 1; j < width - 1; j++) {
        // Simple gradient
        const gx = grayscale[(i) * width + (j + 1)] - grayscale[(i) * width + (j - 1)];
        const gy = grayscale[(i + 1) * width + (j)] - grayscale[(i - 1) * width + (j)];
        
        const magnitude = Math.sqrt(gx * gx + gy * gy);
        
        if (magnitude > threshold) {
          edges.push({ x: j, y: i });
        }
      }
    }
    
    return edges;
  };
  
  const simplifyPoints = (points, tolerance) => {
    if (points.length <= 2) return points;
    
    // Find outermost points for the silhouette
    // This is a simple approach - find points on the convex hull
    const hull = [];
    
    // Find leftmost point
    let leftMost = 0;
    for (let i = 1; i < points.length; i++) {
      if (points[i].x < points[leftMost].x) {
        leftMost = i;
      }
    }
    
    let currentPoint = leftMost;
    let nextPoint;
    
    do {
      hull.push(points[currentPoint]);
      nextPoint = (currentPoint + 1) % points.length;
      
      for (let i = 0; i < points.length; i++) {
        if (isLeft(points[currentPoint], points[i], points[nextPoint]) > 0) {
          nextPoint = i;
        }
      }
      
      currentPoint = nextPoint;
    } while (currentPoint !== leftMost);
    
    return hull;
  };
  
  const isLeft = (p0, p1, p2) => {
    return ((p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y));
  };
  
  const addPoint = (event) => {
    if (!svgRef.current) return;
    
    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Find where to insert the new point (between which existing points)
    let insertIndex = svgPoints.length;
    
    // If we have at least 2 points, find the closest edge
    if (svgPoints.length >= 2) {
      let minDist = Infinity;
      
      for (let i = 0; i < svgPoints.length; i++) {
        const nextI = (i + 1) % svgPoints.length;
        const p1 = svgPoints[i];
        const p2 = svgPoints[nextI];
        
        // Calculate distance from point to line segment
        const dist = pointToLineDistance(x, y, p1.x, p1.y, p2.x, p2.y);
        
        if (dist < minDist) {
          minDist = dist;
          insertIndex = nextI;
        }
      }
    }
    
    const newPoints = [...svgPoints];
    newPoints.splice(insertIndex, 0, { x, y });
    setSvgPoints(newPoints);
  };
  
  const pointToLineDistance = (x, y, x1, y1, x2, y2) => {
    const A = x - x1;
    const B = y - y1;
    const C = x2 - x1;
    const D = y2 - y1;
    
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    
    if (lenSq !== 0) {
      param = dot / lenSq;
    }
    
    let xx, yy;
    
    if (param < 0) {
      xx = x1;
      yy = y1;
    } else if (param > 1) {
      xx = x2;
      yy = y2;
    } else {
      xx = x1 + param * C;
      yy = y1 + param * D;
    }
    
    const dx = x - xx;
    const dy = y - yy;
    
    return Math.sqrt(dx * dx + dy * dy);
  };
  
  const removePoint = (index) => {
    if (svgPoints.length <= 3) return; // Keep at least 3 points for a meaningful shape
    
    const newPoints = [...svgPoints];
    newPoints.splice(index, 1);
    setSvgPoints(newPoints);
    setSelectedPointIndex(null);
  };
  
  const handlePointMouseDown = (index, event) => {
    event.stopPropagation();
    setSelectedPointIndex(index);
    setIsDragging(true);
  };
  
  const handleMouseMove = (event) => {
    if (!isDragging || selectedPointIndex === null) return;
    
    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    const newPoints = [...svgPoints];
    newPoints[selectedPointIndex] = { x, y };
    setSvgPoints(newPoints);
  };
  
  const handleMouseUp = () => {
    setIsDragging(false);
  };
  
  const exportSVG = () => {
    if (!svgRef.current || svgPoints.length === 0) return;
    
    const svgContent = svgRef.current.outerHTML;
    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'silhouette.svg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  
  useEffect(() => {
    if (originalImage) {
      detectEdges();
    }
  }, [originalImage, threshold]);
  
  useEffect(() => {
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);
  
  const getSvgPath = () => {
    if (svgPoints.length === 0) return '';
    
    const start = `M ${svgPoints[0].x} ${svgPoints[0].y}`;
    const points = svgPoints.slice(1).map(point => `L ${point.x} ${point.y}`).join(' ');
    return `${start} ${points} Z`;
  };
  
  return (
    <div className="flex flex-col items-center p-4 max-w-4xl mx-auto bg-gray-50 rounded-lg shadow-md">
      <h1 className="text-2xl font-bold mb-4">Image Silhouette Generator</h1>
      
      <div className="w-full mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h2 className="text-lg font-semibold mb-2">Instructions:</h2>
        <ol className="list-decimal pl-5 space-y-2">
          <li>Upload an image using the file uploader below</li>
          <li>The app will automatically detect edges and create a silhouette</li>
          <li>Adjust the threshold slider to control edge detection sensitivity</li>
          <li>Modify the silhouette:
            <ul className="list-disc pl-5 mt-1">
              <li><strong>Click</strong> anywhere on the image to add new points</li>
              <li><strong>Drag</strong> existing points to reposition them</li>
              <li><strong>Right-click</strong> on a point to remove it</li>
            </ul>
          </li>
          <li>Click "Re-detect Edges" to reset the silhouette</li>
          <li>Click "Export SVG" to download your silhouette</li>
        </ol>
      </div>
      
      <div className="w-full mb-6">
        <div className="flex items-center justify-center w-full">
          <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer bg-gray-100 border-gray-300 hover:bg-gray-200">
            <div className="flex flex-col items-center justify-center pt-5 pb-6">
              <Upload className="w-8 h-8 mb-2 text-gray-500" />
              <p className="mb-2 text-sm text-gray-500">
                <span className="font-semibold">Click to upload</span> or drag and drop
              </p>
              <p className="text-xs text-gray-500">PNG, JPG or JPEG</p>
            </div>
            <input 
              type="file" 
              className="hidden" 
              accept="image/*" 
              onChange={handleImageUpload}
            />
          </label>
        </div>
      </div>
      
      {originalImage && (
        <div className="w-full mb-4">
          <h2 className="text-lg font-semibold mb-2">
            Image with Silhouette Overlay
                          <span className="text-sm font-normal ml-2 text-gray-500">
              (Click to add points, drag to move, right-click to remove)
            </span>
          </h2>
          <div className="relative border rounded shadow-sm" style={{ width: canvasSize.width, height: canvasSize.height }}>
            <canvas 
              ref={canvasRef}
              width={canvasSize.width}
              height={canvasSize.height}
              className="absolute top-0 left-0"
            />
            <svg 
              ref={svgRef}
              width={canvasSize.width}
              height={canvasSize.height}
              className="absolute top-0 left-0"
              onClick={addPoint}
              onMouseMove={handleMouseMove}
              style={{ pointerEvents: 'auto' }}
            >
              <path
                d={getSvgPath()}
                fill="rgba(100, 100, 255, 0.3)"
                stroke="blue"
                strokeWidth="2"
              />
              {svgPoints.map((point, index) => (
                <circle
                  key={index}
                  cx={point.x}
                  cy={point.y}
                  r={selectedPointIndex === index ? 8 : 5}
                  fill={selectedPointIndex === index ? "red" : "blue"}
                  stroke="white"
                  strokeWidth="2"
                  onMouseDown={(e) => handlePointMouseDown(index, e)}
                  onContextMenu={(e) => {
                    e.preventDefault(); 
                    removePoint(index);
                  }}
                  style={{ cursor: "pointer" }}
                />
              ))}
            </svg>
          </div>
        </div>
      )}
      
      {originalImage && (
        <div className="w-full space-y-4">
          <div className="flex flex-col">
            <label className="mb-2 text-sm font-medium">
              Edge Detection Threshold: {threshold}
            </label>
            <input
              type="range"
              min="10"
              max="150"
              value={threshold}
              onChange={(e) => setThreshold(parseInt(e.target.value))}
              className="w-full"
            />
          </div>
          
          <div className="flex space-x-2">
            <button
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center"
              onClick={detectEdges}
            >
              <Camera className="w-4 h-4 mr-2" />
              Re-detect Edges
            </button>
            
            <button
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              onClick={exportSVG}
              disabled={svgPoints.length === 0}
            >
              Export SVG
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SilhouetteGenerator;
