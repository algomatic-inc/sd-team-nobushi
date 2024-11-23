import Map, {
  AttributionControl,
  MapRef,
  Source,
  Layer,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import * as turf from "@turf/turf";
import { useCallback, useEffect, useRef, useState } from "react";

// libs
// osm
import { getNominatimResponseJsonWithCache } from "./lib/osm/getNominatim";
import { getValhallaResponseJsonWithCache } from "./lib/osm/getValhalla";
import { decodePolyline } from "./lib/osm/decodePolyline";
// maplibre
import { fitBoundsToGeoJson } from "./lib/maplibre/fitBoundsToGeoJson";
// gemini
import { extractDepartureAndDestination } from "./lib/gemini/extractDepartureAndDestination";
import { explainSatelliteImagery } from "./lib/gemini/explainRouteImagery";
import { getRouteSatelliteImageryUrl } from "./lib/nobushi/getRouteSatelliteImageryUrl";

// hooks
import { useScrollToBottom } from "./hooks/scrollToBottom";

// components
import { NobushiAutoResizeTextarea } from "./components/NobushiAutoResizeTextarea";
import { NobushiSubmitButton } from "./components/NobushiSubmitButton";
import { NobushiDepartureAndDestination } from "./components/NobushiDepartureAndDestination";
import { NobushiGreetings } from "./components/NobushiGreetings";
import { NobushiSystemMessages } from "./components/NobushiSystemMessages";
import { NobushiExplain } from "./components/NobushiExplain";

function App() {
  const mapRef = useRef<MapRef | null>(null);

  // systemMessage 関連
  const systemMessageEndRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = useScrollToBottom(systemMessageEndRef);
  const [systemMessages, setSystemMessages] = useState([
    "散歩道の入力を待機中…",
  ]);

  // NobushiAutoResizeTextarea の入力状態
  const [value, setValue] = useState("");

  // nominatim によるジオコーディングに必要な情報
  const [departureString, setDepartureString] = useState("");
  const [destinationString, setDestinationString] = useState("");
  // nominatim によるジオコーディングの結果
  // かつ
  // valhalla による経路探索に必要な情報
  const [departureLatLng, setDepartureLatLng] = useState<
    [number, number] | undefined
  >(undefined);
  const [destinationLatLng, setDestinationLatLng] = useState<
    [number, number] | undefined
  >(undefined);

  // valhallaによる経路探索の結果
  const [requiredTime, setRequiredTime] = useState<number | null>(null);
  const [routeGeoJson, setRouteGeoJson] = useState<turf.AllGeoJSON | null>(
    null
  );

  // 宇宙野武士の道語り
  const [nobushiExplain, setNobushiExplain] = useState<string | undefined>(
    undefined
  );

  // systemMessage に表示する内容を更新する関数
  const insertNewSystemMessage = useCallback(
    (message: string) => {
      setSystemMessages((prev) => [...prev, message]);
      scrollToBottom();
    },
    [scrollToBottom]
  );

  // valueからdepartureStringとdestinationStringを抽出する
  const onSubmit = useCallback(async () => {
    if (value === "") {
      return;
    }
    insertNewSystemMessage("散歩道の入力確認。");
    insertNewSystemMessage("散歩道の地名を分析中…");
    const result = await extractDepartureAndDestination(value);
    if (!result) {
      insertNewSystemMessage("エラーが発生しました。");
      return;
    }
    // resultは改行区切りの文字列で、1行目が出発地、2行目が目的地
    // 3行目が空行の場合は許容する
    const lines = result.split("\n").filter((line) => line.trim() !== "");
    if (lines.length !== 2) {
      insertNewSystemMessage("出発地と目的地を正しく入力してください。");
      return;
    }
    const [newDeparture, newDestination] = result.split("\n");
    setDepartureString(newDeparture);
    setDestinationString(newDestination);
    insertNewSystemMessage("散歩道の地名を分析完了。");
  }, [insertNewSystemMessage, value]);

  // departureStringとdestinationStringが入力されたら、
  // nominatimでジオコーディングを行い、
  // departureLatLngとdestinationLatLngを入力する
  useEffect(() => {
    const doit = async () => {
      if (departureString.length > 0 && destinationString.length > 0) {
        insertNewSystemMessage("散歩道の位置情報をを取得中…");
        const departureResult = await getNominatimResponseJsonWithCache(
          departureString
        );
        setDepartureLatLng([departureResult[0].lat, departureResult[0].lon]);
        const destinationResult = await getNominatimResponseJsonWithCache(
          destinationString
        );
        setDestinationLatLng([
          destinationResult[0].lat,
          destinationResult[0].lon,
        ]);
        insertNewSystemMessage("散歩道の位置情報を取得完了。");
      }
    };
    doit();
  }, [departureString, destinationString, insertNewSystemMessage]);

  // departureLatLngとdestinationLatLngが入力されたら、
  // valhallaで経路探索を行い、
  // requiredTimeとrouteGeoJsonを入力する
  useEffect(() => {
    const doit = async () => {
      if (departureLatLng && destinationLatLng) {
        insertNewSystemMessage("散歩道の経路を探索中…");
        const valhallaResult = await getValhallaResponseJsonWithCache(
          {
            lon: departureLatLng[1],
            lat: departureLatLng[0],
          },
          {
            lon: destinationLatLng[1],
            lat: destinationLatLng[0],
          }
        );
        const time = valhallaResult.trip.summary.time;
        setRequiredTime(time);
        const polyline = decodePolyline(valhallaResult.trip.legs[0].shape);
        insertNewSystemMessage("散歩道の経路を探索完了。");
        insertNewSystemMessage("散歩道を表示中…");
        const newGeoJson = {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {},
              geometry: {
                type: "LineString",
                coordinates: polyline,
              },
            },
          ],
        } as turf.AllGeoJSON;
        setRouteGeoJson(newGeoJson);
        fitBoundsToGeoJson(mapRef, newGeoJson, {
          top: 100,
          bottom: 100,
          left: 100,
          right: 100,
        });
        insertNewSystemMessage("散歩道の表示完了。");
      }
    };
    doit();
  }, [departureLatLng, destinationLatLng, insertNewSystemMessage]);

  // requiredTimeとrouteGeoJsonが入力されたら、
  // routeGeoJsonを使って散歩道の人工衛星画像を取得し、
  // explainSatelliteImageryに渡してnobushiExplainを入力する
  useEffect(() => {
    const doit = async () => {
      if (requiredTime && routeGeoJson && !nobushiExplain) {
        if (requiredTime > 3600) {
          insertNewSystemMessage("散歩道の長さが60分以上あります。");
          insertNewSystemMessage("別の散歩ルートを入力してください。");
          return;
        }
        insertNewSystemMessage("散歩道の人工衛星画像を取得中…");
        const imageUrl = await getRouteSatelliteImageryUrl(routeGeoJson);
        // imageUrl を fetch して base64 に変換して explainSatelliteImagery に渡す
        const res = await fetch(imageUrl);
        const blob = await res.blob();
        insertNewSystemMessage("散歩道の人工衛星画像を取得完了。");
        insertNewSystemMessage("散歩道の人工衛星画像を解析中…");
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
          let base64data = reader.result as string;
          base64data = base64data
            .replace("data:application/octet-stream;", "data:image/png;")
            .replace("data:image/png;base64,", "");
          const newNobushiExplain = await explainSatelliteImagery(
            value,
            base64data
          );
          setNobushiExplain(newNobushiExplain ? newNobushiExplain : undefined);
          insertNewSystemMessage("散歩道の人工衛星画像を解析完了。");
        };
      }
    };
    doit();
  }, [
    insertNewSystemMessage,
    nobushiExplain,
    requiredTime,
    routeGeoJson,
    value,
  ]);

  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          height: "100%",
          width: "100%",
          margin: "auto",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          zIndex: 10000,
        }}
      >
        <NobushiGreetings />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            width: "30vw",
            height: "auto",
            padding: "10px",
            borderRadius: "24px",
            background: "rgba(255, 255, 255, 0.8)",
          }}
        >
          <NobushiAutoResizeTextarea value={value} onChange={setValue} />
          <NobushiSubmitButton onSubmit={onSubmit} />
        </div>
        <NobushiExplain explain={nobushiExplain} />
        <NobushiSystemMessages
          systemMessages={systemMessages}
          systemMessageEndRef={systemMessageEndRef}
        />
        <NobushiDepartureAndDestination
          departure={departureString}
          departureLatLng={departureLatLng}
          destination={destinationString}
          destinationLatLng={destinationLatLng}
        />
      </div>
      <div
        style={{
          height: "100vh",
          width: "100vw",
        }}
      >
        <Map
          ref={mapRef}
          id="background"
          initialViewState={{
            latitude: 35.68385063,
            longitude: 139.75397279,
            zoom: 4,
          }}
          style={{ width: "100vw", height: "100vh" }}
          mapStyle="https://unopengis.github.io/foil4g/stylejson/server.arcgisonline.com/world_imagery/style.json"
          attributionControl={false}
        >
          <AttributionControl position="top-right" />
          {routeGeoJson && (
            <>
              <Source id="route" type="geojson" data={routeGeoJson}>
                <Layer
                  {...{
                    id: "route",
                    type: "line",
                    paint: {
                      "line-color": "blue",
                      "line-width": 8,
                    },
                  }}
                />
              </Source>
            </>
          )}
        </Map>
      </div>
    </div>
  );
}

export default App;