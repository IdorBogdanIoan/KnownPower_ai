import { useEffect } from "react";
import { useMap } from "react-leaflet";
import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { maplibreGL } from "@maplibre/maplibre-gl-leaflet";
import "maplibre-gl/dist/maplibre-gl.css";

setWorkerUrl(workerUrl);

export function OpenFreeMapLayer() {
  const map = useMap();
  useEffect(() => {
    const layer = maplibreGL({
      style: "https://tiles.openfreemap.org/styles/liberty",
      interactive: false,
    });
    layer.addTo(map);
    return () => { map.removeLayer(layer); };
  }, [map]);
  return null;
}