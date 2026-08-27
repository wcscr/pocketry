/**
 * OpenCV.js loader - handles the complex UMD/Promise initialization pattern
 */

type OpenCVInstance = any;

let cvInstance: OpenCVInstance | null = null;
let loadPromise: Promise<OpenCVInstance> | null = null;

/**
 * Loads OpenCV.js and waits for it to be ready
 */
export async function loadOpenCV(): Promise<OpenCVInstance> {
  // If already loaded, return the cached instance
  if (cvInstance) {
    console.log("[OpenCV Loader] Already loaded, returning cached instance");
    return cvInstance;
  }

  // If already loading, return the existing promise
  if (loadPromise) {
    console.log("[OpenCV Loader] Load already in progress, waiting...");
    return loadPromise;
  }

  console.log("[OpenCV Loader] Starting fresh load");
  
  loadPromise = new Promise(async (resolve, reject) => {
    const timeoutId = setTimeout(() => {
      console.error("[OpenCV Loader] Load timeout after 30 seconds");
      delete (window as any).Module;
      delete (window as any).cv;
      loadPromise = null;
      reject(new Error("OpenCV load timeout"));
    }, 30000);

    try {
      // Remove any existing script
      const existingScript = document.querySelector('script[src="/opencv/opencv.js"]');
      if (existingScript) {
        console.log("[OpenCV Loader] Removing existing script");
        existingScript.remove();
        delete (window as any).cv;
      }

      // Pre-configure Module with onRuntimeInitialized callback
      (window as any).Module = {
        locateFile: (filename: string) => `/opencv/${filename}`,
        onRuntimeInitialized: async () => {
          console.log("[OpenCV Loader] onRuntimeInitialized fired!");
          
          // Give a moment for WASM to settle
          await new Promise(r => setTimeout(r, 50));
          
          const cvGlobal = (window as any).cv;
          console.log("[OpenCV Loader] cv type:", typeof cvGlobal);
          
          // Check if cv is a Promise or has a 'then' method
          if (cvGlobal && typeof cvGlobal.then === 'function') {
            console.log("[OpenCV Loader] cv is a Promise, awaiting...");
            try {
              const cvResolved = await cvGlobal;
              console.log("[OpenCV Loader] Promise resolved! Has Mat:", typeof cvResolved?.Mat);
              if (cvResolved && typeof cvResolved.Mat !== 'undefined') {
                clearTimeout(timeoutId);
                cvInstance = cvResolved;
                resolve(cvResolved);
              } else {
                console.error("[OpenCV Loader] Promise resolved but no Mat");
                clearTimeout(timeoutId);
                reject(new Error("OpenCV Promise resolved but Mat not found"));
              }
            } catch (err) {
              console.error("[OpenCV Loader] Error awaiting cv Promise:", err);
              clearTimeout(timeoutId);
              reject(err);
            }
          } else if (cvGlobal && typeof cvGlobal.Mat !== 'undefined') {
            console.log("[OpenCV Loader] cv ready with Mat!");
            clearTimeout(timeoutId);
            cvInstance = cvGlobal;
            resolve(cvGlobal);
          } else {
            console.error("[OpenCV Loader] cv exists but no Mat and not a Promise");
            console.error("[OpenCV Loader] cv keys:", cvGlobal ? Object.keys(cvGlobal).slice(0, 10) : 'null');
            clearTimeout(timeoutId);
            reject(new Error("OpenCV loaded but Mat not available"));
          }
        }
      };

      console.log("[OpenCV Loader] Module configured, loading script");

      // Load the script
      const script = document.createElement('script');
      script.src = '/opencv/opencv.js';
      script.async = true;
      
      script.onerror = () => {
        clearTimeout(timeoutId);
        delete (window as any).Module;
        loadPromise = null;
        console.error("[OpenCV Loader] Script failed to load");
        reject(new Error("Failed to load opencv.js script"));
      };

      script.onload = () => {
        console.log("[OpenCV Loader] Script loaded, waiting for runtime init");
      };

      document.head.appendChild(script);
    } catch (error) {
      clearTimeout(timeoutId);
      delete (window as any).Module;
      loadPromise = null;
      console.error("[OpenCV Loader] Error during load:", error);
      reject(error);
    }
  });

  return loadPromise;
}

/**
 * Preload OpenCV in the background (non-blocking)
 */
export async function preloadOpenCV(): Promise<void> {
  try {
    console.log("[OpenCV Loader] Preload started");
    await loadOpenCV();
    console.log("[OpenCV Loader] Preload complete");
  } catch (error) {
    console.error("[OpenCV Loader] Preload failed:", error);
    // Don't throw - app works fine without OpenCV using custom algorithms
  }
}

/**
 * Get the OpenCV instance if already loaded, otherwise load it
 */
export function getOpenCV(): Promise<OpenCVInstance> {
  return loadOpenCV();
}
