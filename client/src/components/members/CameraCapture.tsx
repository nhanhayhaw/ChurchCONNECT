/**
 * Take a member photograph with a connected camera.
 *
 * Opens the camera through getUserMedia, lets the user pick a device when
 * more than one is attached (an external USB webcam over a laptop's built-in
 * one, typically), freezes a frame on Capture, and hands the result to the
 * caller as an ordinary File. From there it follows exactly the same path as
 * a file chosen from disk, so the server's size, type and resize rules apply
 * unchanged.
 *
 * Browsers only expose cameras on HTTPS or localhost. The stream is stopped
 * whenever the dialog closes so the camera light goes off.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, Check, AlertTriangle } from 'lucide-react';
import { Modal, Button, Select } from '@/components/ui';

interface CameraCaptureProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
}

/** Longest side of the captured frame. The server resizes to 512 anyway. */
const MAX_SIDE = 1024;

function describeError(err: unknown): string {
  const name = (err as { name?: string })?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera access was blocked. Allow the camera for this site in your browser, then try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No camera was found. Check that the webcam is plugged in and not in use by another program.';
  }
  if (name === 'NotReadableError') {
    return 'The camera is in use by another application. Close it and try again.';
  }
  return 'The camera could not be started.';
}

export function CameraCapture({ isOpen, onClose, onCapture }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [captured, setCaptured] = useState<{ blob: Blob; url: string } | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startStream = useCallback(
    async (preferredId: string) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This browser does not support camera capture. Choose a file instead.');
        return;
      }
      setIsStarting(true);
      setError(null);
      stopStream();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            ...(preferredId ? { deviceId: { exact: preferredId } } : { facingMode: 'user' }),
            width: { ideal: 1280 },
            height: { ideal: 1280 },
          },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        // Device labels are only revealed after permission has been granted,
        // so enumerate now rather than before the first stream.
        const all = await navigator.mediaDevices.enumerateDevices();
        setDevices(all.filter((d) => d.kind === 'videoinput'));
        const activeId = stream.getVideoTracks()[0]?.getSettings().deviceId;
        if (activeId) setDeviceId(activeId);
      } catch (err) {
        setError(describeError(err));
      } finally {
        setIsStarting(false);
      }
    },
    [stopStream],
  );

  // Open: start the camera. Close: stop it and discard any capture.
  useEffect(() => {
    if (!isOpen) return;
    void startStream(deviceId);
    return () => {
      stopStream();
      setCaptured((c) => {
        if (c) URL.revokeObjectURL(c.url);
        return null;
      });
      setError(null);
    };
    // A device change restarts the stream from the select's handler, not here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const switchDevice = (id: string) => {
    setDeviceId(id);
    void startStream(id);
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;

    const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // The live preview is mirrored for a natural feel; the saved photo is not,
    // so lettering and partings come out the right way round.
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError('The frame could not be captured. Please try again.');
          return;
        }
        setCaptured({ blob, url: URL.createObjectURL(blob) });
      },
      'image/jpeg',
      0.92,
    );
  };

  const retake = () => {
    if (captured) URL.revokeObjectURL(captured.url);
    setCaptured(null);
  };

  const accept = () => {
    if (!captured) return;
    const file = new File([captured.blob], `webcam-${Date.now()}.jpg`, { type: 'image/jpeg' });
    onCapture(file);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Take a photograph"
      description="Look at the camera and press Capture. You can retake as many times as you like."
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {captured ? (
            <>
              <Button variant="outline" onClick={retake} leftIcon={<RefreshCw className="h-4 w-4" />}>
                Retake
              </Button>
              <Button onClick={accept} leftIcon={<Check className="h-4 w-4" />}>
                Use this photo
              </Button>
            </>
          ) : (
            <Button
              onClick={capture}
              disabled={isStarting || Boolean(error)}
              leftIcon={<Camera className="h-4 w-4" />}
            >
              Capture
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {devices.length > 1 && !captured && (
          <Select
            label="Camera"
            value={deviceId}
            onChange={(e) => switchDevice(e.target.value)}
            options={devices.map((d, i) => ({ value: d.deviceId, label: d.label || `Camera ${i + 1}` }))}
          />
        )}

        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-black">
          {/* The video stays mounted while previewing so retake is instant. */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={captured ? 'hidden' : 'h-full w-full -scale-x-100 object-cover'}
          />
          {captured && (
            <img src={captured.url} alt="Captured photograph" className="h-full w-full object-cover" />
          )}
          {isStarting && !captured && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
              Starting camera...
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
              <p className="flex items-start gap-2 rounded-lg bg-white/95 p-3 text-sm text-slate-800 dark:bg-navy-900/95 dark:text-slate-100">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                <span>{error}</span>
              </p>
            </div>
          )}
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          The photograph is cropped to a square and resized on upload, so centre the face in the frame.
        </p>
      </div>
    </Modal>
  );
}
