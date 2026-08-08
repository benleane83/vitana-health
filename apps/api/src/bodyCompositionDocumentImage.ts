import { createRequire } from "node:module";
import jpeg from "jpeg-js";

const maxDetectionSide = 2_200;
const require = createRequire(import.meta.url);

export async function createBodyCompositionDateImage(image: Buffer, mimeType: string): Promise<Buffer | undefined> {
  if (mimeType !== "image/jpeg") return undefined;

  const cv = await getCv();
  const decoded = jpeg.decode(image, { useTArray: true });
  const source = cv.matFromImageData({ data: decoded.data, width: decoded.width, height: decoded.height });
  const oriented = new cv.Mat();
  const detectionImage = new cv.Mat();
  const grayscale = new cv.Mat();
  const thresholded = new cv.Mat();
  const closed = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  let kernel: InstanceType<typeof cv.Mat> | undefined;
  let page: InstanceType<typeof cv.Mat> | undefined;
  let sourcePoints: InstanceType<typeof cv.Mat> | undefined;
  let destinationPoints: InstanceType<typeof cv.Mat> | undefined;
  let transform: InstanceType<typeof cv.Mat> | undefined;
  let corrected: InstanceType<typeof cv.Mat> | undefined;
  let header: InstanceType<typeof cv.Mat> | undefined;
  let enlargedHeader: InstanceType<typeof cv.Mat> | undefined;
  let headerGrayscale: InstanceType<typeof cv.Mat> | undefined;
  let headerThreshold: InstanceType<typeof cv.Mat> | undefined;
  let headerRgba: InstanceType<typeof cv.Mat> | undefined;

  try {
    applyExifOrientation(cv, source, oriented, readExifOrientation(image));
    const scale = Math.min(1, maxDetectionSide / Math.max(oriented.cols, oriented.rows));
    cv.resize(oriented, detectionImage, new cv.Size(Math.round(oriented.cols * scale), Math.round(oriented.rows * scale)));
    cv.cvtColor(detectionImage, grayscale, cv.COLOR_RGBA2GRAY);
    cv.threshold(grayscale, thresholded, 130, 255, cv.THRESH_BINARY);
    const kernelSize = Math.max(7, Math.round(Math.min(detectionImage.cols, detectionImage.rows) * 0.01));
    kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(kernelSize, kernelSize));
    cv.morphologyEx(thresholded, closed, cv.MORPH_CLOSE, kernel);
    cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    page = findPageContour(cv, contours, detectionImage.cols * detectionImage.rows);
    if (!page) return undefined;

    const points = orderCorners(Array.from(page.data32S));
    if (!points) return undefined;
    const width = Math.round(Math.max(distance(points[0], points[1]), distance(points[2], points[3])));
    const height = Math.round(Math.max(distance(points[0], points[3]), distance(points[1], points[2])));
    if (width < 300 || height < 500) return undefined;

    sourcePoints = cv.matFromArray(4, 1, cv.CV_32FC2, points.flatMap((point) => [point.x, point.y]));
    destinationPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width - 1, 0, width - 1, height - 1, 0, height - 1]);
    transform = cv.getPerspectiveTransform(sourcePoints, destinationPoints);
    corrected = new cv.Mat();
    cv.warpPerspective(detectionImage, corrected, transform, new cv.Size(width, height));

    const headerRect = new cv.Rect(
      Math.round(corrected.cols * 0.05),
      Math.round(corrected.rows * 0.1),
      Math.round(corrected.cols * 0.9),
      Math.round(corrected.rows * 0.12)
    );
    header = corrected.roi(headerRect);
    enlargedHeader = new cv.Mat();
    cv.resize(header, enlargedHeader, new cv.Size(header.cols * 3, header.rows * 3), 0, 0, cv.INTER_CUBIC);
    headerGrayscale = new cv.Mat();
    headerThreshold = new cv.Mat();
    headerRgba = new cv.Mat();
    cv.cvtColor(enlargedHeader, headerGrayscale, cv.COLOR_RGBA2GRAY);
    cv.threshold(headerGrayscale, headerThreshold, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    cv.cvtColor(headerThreshold, headerRgba, cv.COLOR_GRAY2RGBA);
    return Buffer.from(jpeg.encode({ data: Buffer.from(headerRgba.data), width: headerRgba.cols, height: headerRgba.rows }, 95).data);
  } finally {
    [source, oriented, detectionImage, grayscale, thresholded, closed, contours, hierarchy, kernel, page, sourcePoints, destinationPoints, transform, corrected, header, enlargedHeader, headerGrayscale, headerThreshold, headerRgba]
      .filter((mat): mat is InstanceType<typeof cv.Mat> => Boolean(mat))
      .forEach((mat) => mat.delete());
  }
}

async function getCv(): Promise<any> {
  const cvModule = require("@techstark/opencv-js");
  if (cvModule instanceof Promise) return cvModule;
  if (cvModule.Mat) return cvModule;
  return new Promise((resolve) => {
    cvModule.onRuntimeInitialized = () => resolve(cvModule);
  });
}

function findPageContour(cv: any, contours: any, imageArea: number): any | undefined {
  let winner: { contour: any; area: number } | undefined;
  for (let index = 0; index < contours.size(); index += 1) {
    const contour = contours.get(index);
    const polygon = new cv.Mat();
    cv.approxPolyDP(contour, polygon, cv.arcLength(contour, true) * 0.02, true);
    const area = Math.abs(cv.contourArea(polygon));
    contour.delete();
    if (polygon.rows === 4 && area >= imageArea * 0.1 && cv.isContourConvex(polygon) && (!winner || area > winner.area)) {
      winner?.contour.delete();
      winner = { contour: polygon, area };
    } else {
      polygon.delete();
    }
  }
  return winner?.contour;
}

interface Point {
  x: number;
  y: number;
}

function orderCorners(values: number[]): [Point, Point, Point, Point] | undefined {
  if (values.length !== 8) return undefined;
  const points = Array.from({ length: 4 }, (_, index) => ({ x: values[index * 2], y: values[index * 2 + 1] }));
  const byY = [...points].sort((left, right) => left.y - right.y);
  const top = byY.slice(0, 2).sort((left, right) => left.x - right.x);
  const bottom = byY.slice(2).sort((left, right) => left.x - right.x);
  return [top[0], top[1], bottom[1], bottom[0]];
}

function distance(left: Point, right: Point): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function applyExifOrientation(cv: any, source: any, target: any, orientation: number): void {
  switch (orientation) {
    case 2:
      cv.flip(source, target, 1);
      return;
    case 3:
      cv.rotate(source, target, cv.ROTATE_180);
      return;
    case 4:
      cv.flip(source, target, 0);
      return;
    case 5:
      cv.transpose(source, target);
      return;
    case 6:
      cv.rotate(source, target, cv.ROTATE_90_CLOCKWISE);
      return;
    case 7:
      cv.transpose(source, target);
      cv.rotate(target, target, cv.ROTATE_180);
      return;
    case 8:
      cv.rotate(source, target, cv.ROTATE_90_COUNTERCLOCKWISE);
      return;
    default:
      source.copyTo(target);
  }
}

function readExifOrientation(image: Buffer): number {
  for (let offset = 2; offset + 10 < image.length;) {
    if (image[offset] !== 0xff) break;
    const marker = image[offset + 1];
    const length = image.readUInt16BE(offset + 2);
    if (marker === 0xe1 && image.toString("ascii", offset + 4, offset + 10) === "Exif\0\0") {
      const tiff = offset + 10;
      const littleEndian = image.toString("ascii", tiff, tiff + 2) === "II";
      const read16 = (position: number) => littleEndian ? image.readUInt16LE(position) : image.readUInt16BE(position);
      const read32 = (position: number) => littleEndian ? image.readUInt32LE(position) : image.readUInt32BE(position);
      const ifd = tiff + read32(tiff + 4);
      const entries = read16(ifd);
      for (let index = 0; index < entries; index += 1) {
        const entry = ifd + 2 + index * 12;
        if (read16(entry) === 0x0112 && read16(entry + 2) === 3 && read32(entry + 4) === 1) return read16(entry + 8);
      }
      return 1;
    }
    if (length < 2) break;
    offset += length + 2;
  }
  return 1;
}