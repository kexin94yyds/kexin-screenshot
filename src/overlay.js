const stage = document.getElementById('stage');
const imageLayer = document.getElementById('imageLayer');
const selection = document.getElementById('selection');
const selectionImage = document.getElementById('selectionImage');
const mosaicLayer = document.getElementById('mosaicLayer');
const annotationLayer = document.getElementById('annotationLayer');
const dimensions = document.getElementById('dimensions');
const toolbar = document.getElementById('toolbar');
const undoButton = document.getElementById('undoButton');
const rectButton = document.getElementById('rectButton');
const arrowButton = document.getElementById('arrowButton');
const mosaicButton = document.getElementById('mosaicButton');
const copyButton = document.getElementById('copyButton');
const saveButton = document.getElementById('saveButton');
const cancelButton = document.getElementById('cancelButton');

const SVG_NS = 'http://www.w3.org/2000/svg';
const ANNOTATION_COLOR = '#ff2f2f';
const ANNOTATION_STROKE = 4;
const MOSAIC_BLOCK_SIZE = 14;
const SNAP_DRAG_THRESHOLD = 5;
const SNAP_MIN_WIDTH = 48;
const SNAP_MIN_HEIGHT = 36;
const SNAP_EDGE_THRESHOLD = 24;
const SNAP_ANALYSIS_MAX_WIDTH = 720;
const mosaicContext = mosaicLayer.getContext('2d');
const mosaicScratchCanvas = document.createElement('canvas');
const mosaicScratchContext = mosaicScratchCanvas.getContext('2d');
const snapAnalysisCanvas = document.createElement('canvas');
const snapAnalysisContext = snapAnalysisCanvas.getContext('2d', { willReadFrequently: true });
let annotationRenderFrame = 0;
let snapAnalysis = null;

const state = {
  sessionId: null,
  ready: false,
  selection: null,
  selectionConfirmed: false,
  previewSelection: false,
  mode: 'rect',
  drawingSelection: false,
  drawingAnnotation: false,
  pendingSnapCommit: false,
  anchorX: 0,
  anchorY: 0,
  snapCandidates: [],
  annotations: [],
  draftAnnotation: null,
};

function nextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    });
  });
}

function waitForImageLoad(image) {
  if (image.complete && image.naturalWidth > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const handleLoad = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error('Failed to load capture preview'));
    };
    const cleanup = () => {
      image.removeEventListener('load', handleLoad);
      image.removeEventListener('error', handleError);
    };

    image.addEventListener('load', handleLoad);
    image.addEventListener('error', handleError);
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeRect(startX, startY, endX, endY) {
  const x = Math.min(startX, endX);
  const y = Math.min(startY, endY);
  const width = Math.abs(endX - startX);
  const height = Math.abs(endY - startY);

  return { x, y, width, height };
}

function insetRect(rect, amount) {
  return {
    x: rect.x + amount,
    y: rect.y + amount,
    width: Math.max(1, rect.width - amount * 2),
    height: Math.max(1, rect.height - amount * 2),
  };
}

function clampRectToViewport(rect) {
  const left = clamp(rect.x, 0, window.innerWidth);
  const top = clamp(rect.y, 0, window.innerHeight);
  const right = clamp(rect.x + rect.width, 0, window.innerWidth);
  const bottom = clamp(rect.y + rect.height, 0, window.innerHeight);

  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(Math.max(0, right - left)),
    height: Math.round(Math.max(0, bottom - top)),
  };
}

function isUsableSnapRect(rect) {
  return rect.width >= SNAP_MIN_WIDTH && rect.height >= SNAP_MIN_HEIGHT;
}

function sameRect(left, right) {
  if (!left || !right) {
    return false;
  }

  return (
    Math.abs(left.x - right.x) <= 1 &&
    Math.abs(left.y - right.y) <= 1 &&
    Math.abs(left.width - right.width) <= 1 &&
    Math.abs(left.height - right.height) <= 1
  );
}

function pointInRect(pointX, pointY, rect) {
  return (
    pointX >= rect.x &&
    pointX <= rect.x + rect.width &&
    pointY >= rect.y &&
    pointY <= rect.y + rect.height
  );
}

function normalizeSnapCandidates(candidates) {
  if (!Array.isArray(candidates)) {
    return [];
  }

  return candidates
    .map((candidate, index) => {
      const rect = clampRectToViewport(candidate.rect ?? candidate);
      if (!isUsableSnapRect(rect)) {
        return null;
      }

      return {
        id: candidate.id ?? `candidate-${index}`,
        source: candidate.source ?? 'window',
        label: candidate.label ?? '自动选区',
        rect: insetRect(rect, 1),
      };
    })
    .filter(Boolean);
}

function createSvgNode(tagName) {
  return document.createElementNS(SVG_NS, tagName);
}

function buildSnapAnalysis() {
  snapAnalysis = null;

  const scale = Math.min(1, SNAP_ANALYSIS_MAX_WIDTH / Math.max(1, window.innerWidth));
  const width = Math.max(1, Math.round(window.innerWidth * scale));
  const height = Math.max(1, Math.round(window.innerHeight * scale));

  snapAnalysisCanvas.width = width;
  snapAnalysisCanvas.height = height;
  snapAnalysisContext.clearRect(0, 0, width, height);
  snapAnalysisContext.drawImage(imageLayer, 0, 0, width, height);

  try {
    snapAnalysis = {
      width,
      height,
      scaleX: width / window.innerWidth,
      scaleY: height / window.innerHeight,
      data: snapAnalysisContext.getImageData(0, 0, width, height).data,
    };
  } catch {
    snapAnalysis = null;
  }
}

function snapPixelOffset(x, y) {
  if (!snapAnalysis) {
    return 0;
  }

  return (y * snapAnalysis.width + x) * 4;
}

function snapColorDiff(x1, y1, x2, y2) {
  const offset1 = snapPixelOffset(x1, y1);
  const offset2 = snapPixelOffset(x2, y2);
  const data = snapAnalysis.data;
  const red = Math.abs(data[offset1] - data[offset2]);
  const green = Math.abs(data[offset1 + 1] - data[offset2 + 1]);
  const blue = Math.abs(data[offset1 + 2] - data[offset2 + 2]);

  return red * 0.299 + green * 0.587 + blue * 0.114;
}

function verticalEdgeScore(x, y, halfSpan) {
  if (!snapAnalysis || x <= 0 || x >= snapAnalysis.width - 1) {
    return 0;
  }

  const startY = clamp(y - halfSpan, 1, snapAnalysis.height - 2);
  const endY = clamp(y + halfSpan, 1, snapAnalysis.height - 2);
  let total = 0;
  let count = 0;

  for (let currentY = startY; currentY <= endY; currentY += 1) {
    total += snapColorDiff(x - 1, currentY, x + 1, currentY);
    count += 1;
  }

  return count ? total / count : 0;
}

function horizontalEdgeScore(x, y, halfSpan) {
  if (!snapAnalysis || y <= 0 || y >= snapAnalysis.height - 1) {
    return 0;
  }

  const startX = clamp(x - halfSpan, 1, snapAnalysis.width - 2);
  const endX = clamp(x + halfSpan, 1, snapAnalysis.width - 2);
  let total = 0;
  let count = 0;

  for (let currentX = startX; currentX <= endX; currentX += 1) {
    total += snapColorDiff(currentX, y - 1, currentX, y + 1);
    count += 1;
  }

  return count ? total / count : 0;
}

function findVerticalBoundary(startX, y, direction, minDistance) {
  if (!snapAnalysis) {
    return null;
  }

  const halfSpan = Math.max(12, Math.round(snapAnalysis.height * 0.018));

  for (
    let x = startX + direction * minDistance;
    x > 1 && x < snapAnalysis.width - 2;
    x += direction
  ) {
    if (verticalEdgeScore(x, y, halfSpan) >= SNAP_EDGE_THRESHOLD) {
      return x;
    }
  }

  return direction < 0 ? 0 : snapAnalysis.width - 1;
}

function findHorizontalBoundary(x, startY, direction, minDistance) {
  if (!snapAnalysis) {
    return null;
  }

  const halfSpan = Math.max(12, Math.round(snapAnalysis.width * 0.018));

  for (
    let y = startY + direction * minDistance;
    y > 1 && y < snapAnalysis.height - 2;
    y += direction
  ) {
    if (horizontalEdgeScore(x, y, halfSpan) >= SNAP_EDGE_THRESHOLD) {
      return y;
    }
  }

  return direction < 0 ? 0 : snapAnalysis.height - 1;
}

function getVisualSnapCandidate(pointerX, pointerY) {
  if (!snapAnalysis) {
    return null;
  }

  const x = clamp(Math.round(pointerX * snapAnalysis.scaleX), 1, snapAnalysis.width - 2);
  const y = clamp(Math.round(pointerY * snapAnalysis.scaleY), 1, snapAnalysis.height - 2);
  const minDistance = Math.max(4, Math.round(10 * snapAnalysis.scaleX));
  const left = findVerticalBoundary(x, y, -1, minDistance);
  const right = findVerticalBoundary(x, y, 1, minDistance);
  const top = findHorizontalBoundary(x, y, -1, minDistance);
  const bottom = findHorizontalBoundary(x, y, 1, minDistance);

  if (left === null || right === null || top === null || bottom === null) {
    return null;
  }

  const rect = clampRectToViewport({
    x: left / snapAnalysis.scaleX,
    y: top / snapAnalysis.scaleY,
    width: (right - left) / snapAnalysis.scaleX,
    height: (bottom - top) / snapAnalysis.scaleY,
  });

  if (!isUsableSnapRect(rect)) {
    return null;
  }

  return {
    id: `visual-${rect.x}-${rect.y}-${rect.width}-${rect.height}`,
    source: 'visual',
    label: '自动选区',
    rect,
  };
}

function cancelScheduledAnnotationRender() {
  if (!annotationRenderFrame) {
    return;
  }

  cancelAnimationFrame(annotationRenderFrame);
  annotationRenderFrame = 0;
}

function scheduleAnnotationRender() {
  if (annotationRenderFrame) {
    return;
  }

  annotationRenderFrame = requestAnimationFrame(() => {
    annotationRenderFrame = 0;
    renderAnnotations();
  });
}

function updateToolButtons() {
  undoButton.disabled = state.annotations.length === 0;
  rectButton.classList.toggle('active', state.mode === 'rect');
  arrowButton.classList.toggle('active', state.mode === 'arrow');
  mosaicButton.classList.toggle('active', state.mode === 'mosaic');
}

function renderArrow(annotation) {
  const group = createSvgNode('g');
  const line = createSvgNode('line');
  const head = createSvgNode('polygon');
  const dx = annotation.end.x - annotation.start.x;
  const dy = annotation.end.y - annotation.start.y;
  const angle = Math.atan2(dy, dx);
  const arrowHead = 16;
  const left = {
    x: annotation.end.x - arrowHead * Math.cos(angle - Math.PI / 6),
    y: annotation.end.y - arrowHead * Math.sin(angle - Math.PI / 6),
  };
  const right = {
    x: annotation.end.x - arrowHead * Math.cos(angle + Math.PI / 6),
    y: annotation.end.y - arrowHead * Math.sin(angle + Math.PI / 6),
  };

  line.setAttribute('x1', annotation.start.x);
  line.setAttribute('y1', annotation.start.y);
  line.setAttribute('x2', annotation.end.x);
  line.setAttribute('y2', annotation.end.y);
  line.setAttribute('stroke', ANNOTATION_COLOR);
  line.setAttribute('stroke-width', ANNOTATION_STROKE);
  line.setAttribute('stroke-linecap', 'round');

  head.setAttribute(
    'points',
    `${annotation.end.x},${annotation.end.y} ${left.x},${left.y} ${right.x},${right.y}`
  );
  head.setAttribute('fill', ANNOTATION_COLOR);

  group.append(line, head);
  return group;
}

function getImageScale() {
  return {
    x: imageLayer.naturalWidth / window.innerWidth,
    y: imageLayer.naturalHeight / window.innerHeight,
  };
}

function drawMosaicRegion(context, annotation, outputScale = 1) {
  const imageScale = getImageScale();
  const sourceX = Math.round((state.selection.x + annotation.x) * imageScale.x);
  const sourceY = Math.round((state.selection.y + annotation.y) * imageScale.y);
  const sourceWidth = Math.max(1, Math.round(annotation.width * imageScale.x));
  const sourceHeight = Math.max(1, Math.round(annotation.height * imageScale.y));
  const destinationX = Math.round(annotation.x * outputScale);
  const destinationY = Math.round(annotation.y * outputScale);
  const destinationWidth = Math.max(1, Math.round(annotation.width * outputScale));
  const destinationHeight = Math.max(1, Math.round(annotation.height * outputScale));
  const blockSize = Math.max(4, Math.round(MOSAIC_BLOCK_SIZE * outputScale));
  const sampleWidth = Math.max(1, Math.ceil(destinationWidth / blockSize));
  const sampleHeight = Math.max(1, Math.ceil(destinationHeight / blockSize));

  mosaicScratchCanvas.width = sampleWidth;
  mosaicScratchCanvas.height = sampleHeight;
  mosaicScratchContext.imageSmoothingEnabled = true;
  mosaicScratchContext.drawImage(
    imageLayer,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sampleWidth,
    sampleHeight
  );

  context.save();
  context.imageSmoothingEnabled = false;
  context.drawImage(
    mosaicScratchCanvas,
    0,
    0,
    sampleWidth,
    sampleHeight,
    destinationX,
    destinationY,
    destinationWidth,
    destinationHeight
  );
  context.restore();
}

function renderMosaics() {
  const width = Math.max(1, Math.round(state.selection?.width ?? 1));
  const height = Math.max(1, Math.round(state.selection?.height ?? 1));

  if (mosaicLayer.width !== width) {
    mosaicLayer.width = width;
  }
  if (mosaicLayer.height !== height) {
    mosaicLayer.height = height;
  }
  mosaicContext.clearRect(0, 0, width, height);

  if (!state.selection) {
    return;
  }

  const items = state.draftAnnotation
    ? [...state.annotations, state.draftAnnotation]
    : state.annotations;

  for (const annotation of items) {
    if (annotation.type !== 'mosaic') {
      continue;
    }

    drawMosaicRegion(mosaicContext, annotation, 1);
  }
}

function renderAnnotations() {
  cancelScheduledAnnotationRender();
  renderMosaics();
  annotationLayer.replaceChildren();

  if (!state.selection) {
    return;
  }

  const items = state.draftAnnotation
    ? [...state.annotations, state.draftAnnotation]
    : state.annotations;

  for (const annotation of items) {
    if (annotation.type === 'mosaic') {
      continue;
    }

    if (annotation.type === 'rect') {
      const node = createSvgNode('rect');
      node.setAttribute('x', annotation.x);
      node.setAttribute('y', annotation.y);
      node.setAttribute('width', annotation.width);
      node.setAttribute('height', annotation.height);
      node.setAttribute('fill', 'none');
      node.setAttribute('stroke', ANNOTATION_COLOR);
      node.setAttribute('stroke-width', ANNOTATION_STROKE);
      node.setAttribute('rx', '2');
      annotationLayer.append(node);
      continue;
    }

    annotationLayer.append(renderArrow(annotation));
  }
}

function resetAnnotations() {
  state.annotations = [];
  state.draftAnnotation = null;
  updateToolButtons();
  renderAnnotations();
}

function hideSelectionUi() {
  selection.classList.add('hidden');
  selection.classList.remove('auto-snap');
  dimensions.classList.add('hidden');
  toolbar.classList.add('hidden');
  stage.classList.remove('has-selection');
  state.selection = null;
  state.selectionConfirmed = false;
  state.previewSelection = false;
  state.pendingSnapCommit = false;
  resetAnnotations();
}

function showSelectionUi(rect, options = {}) {
  const isPreview = Boolean(options.preview);
  state.selection = rect;
  state.selectionConfirmed = !isPreview;
  state.previewSelection = isPreview;

  selection.classList.remove('hidden');
  selection.classList.toggle('auto-snap', isPreview);
  dimensions.classList.remove('hidden');
  toolbar.classList.toggle('hidden', isPreview);
  stage.classList.add('has-selection');

  selection.style.left = `${rect.x}px`;
  selection.style.top = `${rect.y}px`;
  selection.style.width = `${rect.width}px`;
  selection.style.height = `${rect.height}px`;

  selectionImage.style.left = `${-rect.x}px`;
  selectionImage.style.top = `${-rect.y}px`;

  const sizeText = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
  dimensions.textContent = isPreview ? `点击选中 · ${sizeText}` : sizeText;
  dimensions.style.left = `${rect.x}px`;
  dimensions.style.top = `${Math.max(12, rect.y - 38)}px`;

  const toolbarWidth = toolbar.offsetWidth || 340;
  const toolbarHeight = toolbar.offsetHeight || 58;
  const preferredLeft = rect.x + rect.width - toolbarWidth;
  const toolbarLeft = clamp(preferredLeft, 12, window.innerWidth - toolbarWidth - 12);
  const preferredTop = rect.y + rect.height + 12;
  const toolbarTop =
    preferredTop + toolbarHeight < window.innerHeight
      ? preferredTop
      : Math.max(12, rect.y - toolbarHeight - 12);

  toolbar.style.left = `${toolbarLeft}px`;
  toolbar.style.top = `${toolbarTop}px`;
  annotationLayer.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
  updateToolButtons();

  if (state.annotations.length > 0 || state.draftAnnotation) {
    renderAnnotations();
  }
}

function updateSelection(pointerX, pointerY) {
  const rect = normalizeRect(state.anchorX, state.anchorY, pointerX, pointerY);

  if (rect.width < 2 || rect.height < 2) {
    hideSelectionUi();
    return;
  }

  showSelectionUi(rect);
}

function isPointInsideSelection(pointX, pointY) {
  if (!state.selection) {
    return false;
  }

  return pointInRect(pointX, pointY, state.selection);
}

function getWindowSnapCandidate(pointerX, pointerY) {
  return state.snapCandidates.find((candidate) =>
    pointInRect(pointerX, pointerY, candidate.rect)
  ) ?? null;
}

function getSnapCandidate(pointerX, pointerY) {
  return getWindowSnapCandidate(pointerX, pointerY) ?? getVisualSnapCandidate(pointerX, pointerY);
}

function updateSnapPreview(pointerX, pointerY) {
  if (state.selectionConfirmed || state.drawingSelection || state.drawingAnnotation) {
    return;
  }

  const candidate = getSnapCandidate(pointerX, pointerY);

  if (!candidate) {
    if (state.previewSelection) {
      hideSelectionUi();
    }
    return;
  }

  if (state.previewSelection && sameRect(state.selection, candidate.rect)) {
    return;
  }

  resetAnnotations();
  showSelectionUi(candidate.rect, { preview: true, label: candidate.label });
}

function commitSnapPreview() {
  if (!state.previewSelection || !state.selection) {
    return false;
  }

  const rect = state.selection;
  resetAnnotations();
  showSelectionUi(rect, { preview: false });
  return true;
}

function clampPointToSelection(pointX, pointY) {
  if (!state.selection) {
    return { x: pointX, y: pointY };
  }

  return {
    x: clamp(pointX, state.selection.x, state.selection.x + state.selection.width),
    y: clamp(pointY, state.selection.y, state.selection.y + state.selection.height),
  };
}

function toSelectionLocalPoint(pointX, pointY) {
  const point = clampPointToSelection(pointX, pointY);
  return {
    x: point.x - state.selection.x,
    y: point.y - state.selection.y,
  };
}

function createDraftAnnotation(pointerX, pointerY) {
  if (!state.selection) {
    return null;
  }

  const start = toSelectionLocalPoint(state.anchorX, state.anchorY);
  const end = toSelectionLocalPoint(pointerX, pointerY);

  if (state.mode === 'arrow') {
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length < 6) {
      return null;
    }

    return { type: 'arrow', start, end };
  }

  const rect = normalizeRect(start.x, start.y, end.x, end.y);
  if (rect.width < 6 || rect.height < 6) {
    return null;
  }

  if (state.mode === 'mosaic') {
    return { type: 'mosaic', ...rect };
  }

  return { type: 'rect', ...rect };
}

function setMode(mode) {
  state.mode = mode;
  updateToolButtons();
}

function undoLastAnnotation() {
  if (state.annotations.length === 0) {
    return;
  }

  state.annotations.pop();
  updateToolButtons();
  renderAnnotations();
}

function getRenderedCaptureDataUrl() {
  if (!state.selection) {
    return null;
  }

  const naturalWidth = imageLayer.naturalWidth;
  const naturalHeight = imageLayer.naturalHeight;
  const scaleX = naturalWidth / window.innerWidth;
  const scaleY = naturalHeight / window.innerHeight;
  const canvas = document.createElement('canvas');
  const targetWidth = Math.max(1, Math.round(state.selection.width * scaleX));
  const targetHeight = Math.max(1, Math.round(state.selection.height * scaleY));
  const context = canvas.getContext('2d');

  canvas.width = targetWidth;
  canvas.height = targetHeight;

  context.drawImage(
    imageLayer,
    Math.round(state.selection.x * scaleX),
    Math.round(state.selection.y * scaleY),
    targetWidth,
    targetHeight,
    0,
    0,
    targetWidth,
    targetHeight
  );

  context.strokeStyle = ANNOTATION_COLOR;
  context.fillStyle = ANNOTATION_COLOR;
  context.lineWidth = Math.max(2, ANNOTATION_STROKE * scaleX);
  context.lineCap = 'round';
  context.lineJoin = 'round';

  for (const annotation of state.annotations) {
    if (annotation.type === 'mosaic') {
      drawMosaicRegion(context, annotation, scaleX);
      continue;
    }

    if (annotation.type === 'rect') {
      context.strokeRect(
        annotation.x * scaleX,
        annotation.y * scaleY,
        annotation.width * scaleX,
        annotation.height * scaleY
      );
      continue;
    }

    const startX = annotation.start.x * scaleX;
    const startY = annotation.start.y * scaleY;
    const endX = annotation.end.x * scaleX;
    const endY = annotation.end.y * scaleY;
    const angle = Math.atan2(endY - startY, endX - startX);
    const arrowHead = Math.max(10, 16 * scaleX);
    const leftX = endX - arrowHead * Math.cos(angle - Math.PI / 6);
    const leftY = endY - arrowHead * Math.sin(angle - Math.PI / 6);
    const rightX = endX - arrowHead * Math.cos(angle + Math.PI / 6);
    const rightY = endY - arrowHead * Math.sin(angle + Math.PI / 6);

    context.beginPath();
    context.moveTo(startX, startY);
    context.lineTo(endX, endY);
    context.stroke();

    context.beginPath();
    context.moveTo(endX, endY);
    context.lineTo(leftX, leftY);
    context.lineTo(rightX, rightY);
    context.closePath();
    context.fill();
  }

  return canvas.toDataURL('image/png');
}

async function cancelCapture() {
  if (!state.sessionId) {
    return;
  }

  await window.qqShot.cancelCapture(state.sessionId);
}

async function copySelection() {
  if (!state.selection) {
    return;
  }

  copyButton.disabled = true;
  saveButton.disabled = true;

  try {
    await window.qqShot.copyRenderedCapture(state.sessionId, getRenderedCaptureDataUrl());
  } finally {
    copyButton.disabled = false;
    saveButton.disabled = false;
  }
}

async function saveSelection() {
  if (!state.selection) {
    return;
  }

  copyButton.disabled = true;
  saveButton.disabled = true;

  try {
    await window.qqShot.saveRenderedCapture(state.sessionId, getRenderedCaptureDataUrl());
  } finally {
    copyButton.disabled = false;
    saveButton.disabled = false;
  }
}

stage.addEventListener('mousedown', (event) => {
  if (!state.ready) {
    return;
  }

  if (event.button !== 0) {
    return;
  }

  if (toolbar.contains(event.target)) {
    return;
  }

  state.anchorX = clamp(event.clientX, 0, window.innerWidth);
  state.anchorY = clamp(event.clientY, 0, window.innerHeight);

  if (state.selection && isPointInsideSelection(state.anchorX, state.anchorY)) {
    state.drawingAnnotation = true;
    state.draftAnnotation = createDraftAnnotation(state.anchorX, state.anchorY);
    renderAnnotations();
    return;
  }

  state.drawingSelection = true;
  resetAnnotations();
  updateSelection(state.anchorX, state.anchorY);
});

window.addEventListener('mousemove', (event) => {
  if (!state.ready) {
    return;
  }

  const pointerX = clamp(event.clientX, 0, window.innerWidth);
  const pointerY = clamp(event.clientY, 0, window.innerHeight);

  if (state.drawingSelection) {
    updateSelection(pointerX, pointerY);
    return;
  }

  if (state.drawingAnnotation) {
    state.draftAnnotation = createDraftAnnotation(pointerX, pointerY);
    scheduleAnnotationRender();
  }
});

window.addEventListener('mouseup', () => {
  if (!state.ready) {
    return;
  }

  if (state.drawingAnnotation && state.draftAnnotation) {
    state.annotations.push(state.draftAnnotation);
  }

  state.drawingSelection = false;
  state.drawingAnnotation = false;
  state.draftAnnotation = null;
  updateToolButtons();
  renderAnnotations();
});

window.addEventListener('keydown', async (event) => {
  if (!state.ready && event.key !== 'Escape') {
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    await cancelCapture();
    return;
  }

  if (event.key === 'Enter' && state.selection) {
    event.preventDefault();
    await copySelection();
    return;
  }

  const lowerKey = event.key.toLowerCase();
  const isUndoShortcut = (event.metaKey || event.ctrlKey) && lowerKey === 'z';
  if (isUndoShortcut && state.selection) {
    event.preventDefault();
    undoLastAnnotation();
    return;
  }

  if (lowerKey === 'r' && state.selection) {
    event.preventDefault();
    setMode('rect');
    return;
  }

  if (lowerKey === 'a' && state.selection) {
    event.preventDefault();
    setMode('arrow');
    return;
  }

  if (lowerKey === 'm' && state.selection) {
    event.preventDefault();
    setMode('mosaic');
    return;
  }

  const isSaveShortcut = (event.metaKey || event.ctrlKey) && lowerKey === 's';
  if (isSaveShortcut && state.selection) {
    event.preventDefault();
    await saveSelection();
  }
});

window.addEventListener('contextmenu', (event) => {
  event.preventDefault();
});

undoButton.addEventListener('click', (event) => {
  event.stopPropagation();
  undoLastAnnotation();
});

rectButton.addEventListener('click', (event) => {
  event.stopPropagation();
  setMode('rect');
});

arrowButton.addEventListener('click', (event) => {
  event.stopPropagation();
  setMode('arrow');
});

mosaicButton.addEventListener('click', (event) => {
  event.stopPropagation();
  setMode('mosaic');
});

copyButton.addEventListener('click', async (event) => {
  event.stopPropagation();
  await copySelection();
});

saveButton.addEventListener('click', async (event) => {
  event.stopPropagation();
  await saveSelection();
});

cancelButton.addEventListener('click', async (event) => {
  event.stopPropagation();
  await cancelCapture();
});

window.qqShot.onCaptureData(async (payload) => {
  state.sessionId = payload.sessionId;
  state.ready = false;
  state.selection = null;
  state.drawingSelection = false;
  state.drawingAnnotation = false;
  hideSelectionUi();
  copyButton.disabled = false;
  saveButton.disabled = false;
  setMode('rect');

  imageLayer.removeAttribute('src');
  selectionImage.removeAttribute('src');
  imageLayer.src = payload.preview.src;
  selectionImage.src = payload.preview.src;
  await waitForImageLoad(imageLayer);
  await nextPaint();
  window.qqShot.reportOverlayMetrics({
    viewport: { width: window.innerWidth, height: window.innerHeight },
    displayBounds: payload.display.bounds,
    image: { width: imageLayer.naturalWidth, height: imageLayer.naturalHeight },
  });

  state.ready = true;
  await window.qqShot.overlayReady(state.sessionId);
});
