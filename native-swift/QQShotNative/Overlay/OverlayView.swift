import SwiftUI

struct OverlayView: View {
  @ObservedObject var selectionState: SelectionState
  let onSelectionCommitted: (CGRect, CGSize) -> Void

  var body: some View {
    GeometryReader { geometry in
      ZStack(alignment: .topLeading) {
        if let capturedImage = selectionState.capturedImage {
          Image(decorative: capturedImage, scale: 1.0, orientation: .up)
            .resizable()
            .frame(width: geometry.size.width, height: geometry.size.height)
            .ignoresSafeArea()
        } else {
          Color.black.opacity(0.18)
            .ignoresSafeArea()
        }

        selectionMask(in: geometry.size)

        if !selectionState.currentRect.isEmpty {
          selectionOutline
          selectionSizeLabel
        }

        if selectionState.capturedImage == nil {
          statusPanel
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        }
      }
      .contentShape(Rectangle())
      .gesture(selectionGesture(in: geometry.size))
    }
  }

  private var statusPanel: some View {
    VStack(alignment: .center, spacing: 8) {
      Text(selectionState.statusMessage)
        .font(.system(size: 14))
        .multilineTextAlignment(.center)
        .foregroundColor(.primary)
    }
    .padding(.horizontal, 20)
    .padding(.vertical, 16)
    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18))
  }

  private var selectionOutline: some View {
    Rectangle()
      .path(in: selectionState.currentRect)
      .stroke(Color.white, lineWidth: 2)
  }

  private var selectionSizeLabel: some View {
    Text("\(Int(selectionState.currentRect.width)) × \(Int(selectionState.currentRect.height))")
      .font(.system(size: 12, weight: .medium))
      .padding(.horizontal, 10)
      .padding(.vertical, 6)
      .background(.thinMaterial, in: Capsule())
      .offset(
        x: selectionState.currentRect.minX + 12,
        y: max(selectionState.currentRect.minY - 30, 16)
      )
  }

  private func selectionMask(in size: CGSize) -> some View {
    Path { path in
      path.addRect(CGRect(origin: .zero, size: size))
      if !selectionState.currentRect.isEmpty {
        path.addRect(selectionState.currentRect)
      }
    }
    .fill(Color.black.opacity(0.34), style: FillStyle(eoFill: true))
    .ignoresSafeArea()
  }

  private func selectionGesture(in size: CGSize) -> some Gesture {
    DragGesture(minimumDistance: 0)
      .onChanged { value in
        if selectionState.dragStart == nil {
          selectionState.beginSelection(at: clamp(value.startLocation, to: size))
        }

        selectionState.updateSelection(to: clamp(value.location, to: size))
      }
      .onEnded { value in
        let rect = selectionState.finishSelection(at: clamp(value.location, to: size))
        guard !rect.isEmpty else {
          return
        }

        onSelectionCommitted(rect, size)
      }
  }

  private func clamp(_ point: CGPoint, to size: CGSize) -> CGPoint {
    CGPoint(
      x: min(max(point.x, 0), size.width),
      y: min(max(point.y, 0), size.height)
    )
  }
}
