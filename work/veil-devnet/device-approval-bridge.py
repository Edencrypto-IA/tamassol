"""Read-only status or one physical approval challenge; never sends Solana transactions."""
import argparse,json,time
from pathlib import Path
import serial
p=argparse.ArgumentParser();p.add_argument('--port',default='COM3');p.add_argument('--request',type=Path);p.add_argument('--out',type=Path);a=p.parse_args()
s=serial.Serial(port=None,baudrate=115200,timeout=.2);s.dtr=False;s.rts=False;s.port=a.port
try:
 s.open();s.write(b'\nVEIL STATUS\n');deadline=time.monotonic()+8;status=None
 while time.monotonic()<deadline:
  line=s.readline().decode('ascii',errors='replace').strip()
  if line.startswith('@VEIL STATUS '):status=line;break
 if not status:raise RuntimeError('No Veil firmware response')
 parts=status.split();assert len(parts)==5 and parts[2]=='ready','Device unavailable'
 print(status,flush=True)
 if a.request:
  assert a.out,'Output path required'
  env=json.loads(a.request.read_text(encoding='utf8'));started=int(time.time()*1000)
  data=('VEIL REQUEST '+json.dumps(env,separators=(',',':'),ensure_ascii=True)+'\n').encode('ascii');assert len(data)<3072
  # ESP32 USB receive buffer is small; do not burst the whole JSON into it.
  for offset in range(0,len(data),48):
   s.write(data[offset:offset+48]);s.flush();time.sleep(.08)
  deadline=time.monotonic()+100
  while time.monotonic()<deadline:
   line=s.readline().decode('ascii',errors='replace').strip()
   if not line.startswith('@VEIL '):continue
   print(line,flush=True)
   if line.startswith('@VEIL PENDING '):continue
   result={'statusLine':status,'response':line,'receivedAtMs':int(time.time()*1000),'startedAtMs':started,'hardwareInteraction':True,'solanaTransactionSent':False}
   # Exclusive output protects the prior evidence from accidental overwriting.
   with a.out.open('x',encoding='utf8') as f:json.dump(result,f,indent=2)
   break
  else:raise TimeoutError('No physical decision; no automatic retry')
finally:s.close()
