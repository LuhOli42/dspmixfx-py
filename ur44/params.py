"""
UR44 mixer parameter table.

Ported from polyrainbow/steinmixer (Apache-2.0), which reverse-engineered the
Steinberg dspMixFx SysEx protocol for the original UR44:
https://github.com/polyrainbow/steinmixer

channel field meanings:
  "null"    -> parameter is global, no channel index needed
  "stack"   -> caller must supply a channel-strip stack index (0-3)
  "N"       -> fixed input channel index (0-5)
  "N+M+..." -> the same value must be written to all listed channel indexes
"""

from dataclasses import dataclass

_TABLE = """
Input0Link,0,0,0,1,0,937,false
Input2Link,0,2,0,1,0,939,false
Input4Link,0,4,0,1,0,942,false

Input0InvertPhase,2,0,0,1,0,951,false
Input1InvertPhase,2,1,0,1,0,952,false
Input2InvertPhase,2,2,0,1,0,953,false
Input3InvertPhase,2,3,0,1,0,954,false
Input4InvertPhase,2,4,0,1,0,955,false
Input5InvertPhase,2,5,0,1,0,956,false

Input0HPFEnabled,3,0,0,1,0,958,false
Input1HPFEnabled,3,1,0,1,0,959,false
Input2HPFEnabled,3,2,0,1,0,960,false
Input3HPFEnabled,3,3,0,1,0,961,false

InputHPFSetting,4,0+1+2+3+4+5,0,4,2,964,false

Mix0Input0Solo,7,0,0,1,0,999,false
Mix0Input1Solo,7,1,0,1,0,1000,false
Mix0Input2Solo,7,2,0,1,0,1001,false
Mix0Input3Solo,7,3,0,1,0,1002,false
Mix0Input4Solo,7,4,0,1,0,1003,false
Mix0Input5Solo,7,5,0,1,0,1004,false

Mix1Input0Solo,8,0,0,1,0,1006,false
Mix1Input1Solo,8,1,0,1,0,1007,false
Mix1Input2Solo,8,2,0,1,0,1008,false
Mix1Input3Solo,8,3,0,1,0,1009,false
Mix1Input4Solo,8,4,0,1,0,1010,false
Mix1Input5Solo,8,5,0,1,0,1011,false

Mix0Input0Mute,9,0,0,1,1,1012,false
Mix0Input1Mute,9,1,0,1,1,1014,false
Mix0Input2Mute,9,2,0,1,1,1015,false
Mix0Input3Mute,9,3,0,1,1,1016,false
Mix0Input4Mute,9,4,0,1,1,1017,false
Mix0Input5Mute,9,5,0,1,1,1018,false

Mix1Input0Mute,10,0,0,1,1,1019,false
Mix1Input1Mute,10,1,0,1,1,1020,false
Mix1Input2Mute,10,2,0,1,1,1022,false
Mix1Input3Mute,10,3,0,1,1,1023,false
Mix1Input4Mute,10,4,0,1,1,1024,false
Mix1Input5Mute,10,5,0,1,1,1025,false

Mix0Input0Volume,12,0,0,127,103,1033,false
Mix0Input1Volume,12,1,0,127,103,1034,false
Mix0Input2Volume,12,2,0,127,103,1035,false
Mix0Input3Volume,12,3,0,127,103,1036,false
Mix0Input4Volume,12,4,0,127,103,1038,false
Mix0Input5Volume,12,5,0,127,103,1039,false

Mix1Input0Volume,13,0,0,127,103,1040,false
Mix1Input1Volume,13,1,0,127,103,1041,false
Mix1Input2Volume,13,2,0,127,103,1042,false
Mix1Input3Volume,13,3,0,127,103,1043,false
Mix1Input4Volume,13,4,0,127,103,1044,false
Mix1Input5Volume,13,5,0,127,103,1046,false

Input0ReverbSend,14,0,0,127,0,1047,false
Input1ReverbSend,14,1,0,127,0,1048,false
Input2ReverbSend,14,2,0,127,0,1049,false
Input3ReverbSend,14,3,0,127,0,1050,false
Input4ReverbSend,14,4,0,127,0,1051,false
Input5ReverbSend,14,5,0,127,0,1052,false

Mix0Input0Pan,15,0,-16,16,0,1054,false
Mix0Input1Pan,15,1,-16,16,0,1055,false
Mix0Input2Pan,15,2,-16,16,0,1056,false
Mix0Input3Pan,15,3,-16,16,0,1057,false
Mix0Input4Pan,15,4,-16,16,0,1058,false
Mix0Input5Pan,15,5,-16,16,0,1059,false

Mix1Input0Pan,16,0,-16,16,0,1060,false
Mix1Input1Pan,16,1,-16,16,0,1062,false
Mix1Input2Pan,16,2,-16,16,0,1063,false
Mix1Input3Pan,16,3,-16,16,0,1064,false
Mix1Input4Pan,16,4,-16,16,0,1065,false
Mix1Input5Pan,16,5,-16,16,0,1066,false

Mix0DAWSolo,17,null,0,1,0,1067,false
Mix1DAWSolo,18,null,0,1,0,1068,false
Mix0DAWMute,19,null,0,1,1,1070,false
Mix1DAWMute,20,null,0,1,1,1071,false
Mix0DAWVolume,21,null,0,127,103,1072,false
Mix1DAWVolume,22,null,0,127,103,1073,false
Mix0DAWPan,23,null,-16,16,0,1074,false
Mix1DAWPan,24,null,-16,16,0,1075,false

Mix0MainMute,28,null,0,1,1,3489,false
Mix1MainMute,29,null,0,1,1,3490,false
Mix0MainVolume,30,null,0,127,103,3491,false
Mix1MainVolume,31,null,0,127,103,3492,false

Mix0MainPan,32,null,-16,16,0,3494,false
Mix1MainPan,33,null,-16,16,0,3495,false

Phones2Output,34,null,0,1,0,3496,false
Loopback,100,null,0,1,0,3499,false
Input45Level,41,2,0,1,0,3510,false

ReverbType,65,null,0,2,0,3386,false
ReverbTime,66,null,0,69,23,3387,false
ReverbDiffusion,67,null,0,10,10,3388,false
ReverbInitialDelay,68,null,0,127,2,3390,false
ReverbHPF,69,null,0,52,4,3391,false
ReverbLPF,70,null,34,60,50,3392,false
ReverbRoomSize,71,null,0,31,29,3393,false
ReverbHighRatio,72,null,1,10,8,3394,false
ReverbLowRatio,73,null,1,14,12,3395,false
ReverbDecay,74,null,0,63,27,3396,false
ReverbLowFreq,76,null,1,59,32,3399,false
Mix0ReverbVolume,79,null,0,127,103,3402,false
Mix1ReverbVolume,80,null,0,127,103,3403,false

ReverbInputMix,37,null,0,1,0,3500,false

PhantomPower01,null,null,0,1,null,3504,true
PhantomPower23,null,null,0,1,null,3505,true

ChannelStripCompEnabled,43,stack,0,1,0,2,false
ChannelStripCompDrive,44,stack,0,200,100,2,false
ChannelStripCompAttack,45,stack,57,283,184,2,false
ChannelStripCompRelease,46,stack,24,300,159,2,false
ChannelStripCompRatio,47,stack,0,120,30,2,false
ChannelStripCompKnee,48,stack,0,2,1,2,false
ChannelStripCompSideChEnabled,199,stack,0,1,1,2,false
ChannelStripCompSideChFreq,51,stack,4,124,30,2,false
ChannelStripCompSideChGain,52,stack,0,360,133,2,false
ChannelStripCompSideChQ,53,stack,0,60,12,2,false
ChannelStripMorphing,54,stack,0,200,100,2,false
ChannelStripEQEnabled,55,stack,0,1,0,2,false
ChannelStripEQHighFreq,56,stack,60,124,112,2,false
ChannelStripEQHighGain,57,stack,0,360,180,2,false
ChannelStripEQMidFreq,58,stack,4,124,71,2,false
ChannelStripEQMidGain,59,stack,0,360,180,2,false
ChannelStripEQMidQ,60,stack,0,60,12,2,false
ChannelStripEQLowFreq,61,stack,4,72,32,2,false
ChannelStripEQLowGain,62,stack,0,360,180,2,false
ChannelStripTotalGain,63,stack,0,360,180,2,false

AmpType,102,null,0,3,0,3406,false

AmpCleanVolume,104,null,0,64,32,3408,false
AmpCleanDistortion,105,null,0,64,32,3409,false
AmpCleanModulation,116,null,0,2,1,3422,false
AmpCleanVibratoSpeed,117,null,0,64,32,3423,false
AmpCleanVibratoDepth,118,null,0,64,32,3424,false
AmpCleanTreble,108,null,0,64,32,3412,false
AmpCleanMiddle,107,null,0,64,32,3411,false
AmpCleanBass,106,null,0,64,32,3410,false
AmpCleanPresence,109,null,0,64,32,3414,false
AmpCleanBlend,103,null,0,64,32,3407,false
AmpCleanOutput,111,null,0,127,32,3416,false

AmpCrunchMode,121,null,0,1,1,3427,false
AmpCrunchGain,122,null,0,64,32,3428,false
AmpCrunchTreble,126,null,0,64,32,3433,false
AmpCrunchMiddle,125,null,0,64,32,3432,false
AmpCrunchBass,124,null,0,64,32,3431,false
AmpCrunchPresence,127,null,0,64,32,3434,false
AmpCrunchOutput,129,null,0,127,32,3436,false

AmpLeadType,139,null,0,5,1,3448,false
AmpLeadGain,140,null,0,64,32,3449,false
AmpLeadMaster,146,null,0,64,32,3456,false
AmpLeadTreble,144,null,0,64,32,3454,false
AmpLeadMiddle,143,null,0,64,32,3452,false
AmpLeadBass,142,null,0,64,32,3451,false
AmpLeadPresence,145,null,0,64,32,3455,false
AmpLeadOutput,147,null,0,127,32,3457,false

AmpDriveType,157,null,0,5,1,3468,false
AmpDriveGain,158,null,0,64,32,3470,false
AmpDriveMaster,164,null,0,64,32,3476,false
AmpDriveTreble,162,null,0,64,32,3474,false
AmpDriveMiddle,161,null,0,64,32,3473,false
AmpDriveBass,160,null,0,64,32,3472,false
AmpDrivePresence,163,null,0,64,32,3475,false
AmpDriveOutput,165,null,0,127,32,3478,false
"""


@dataclass
class Param:
    name: str
    number: int | None
    channel: str  # "null", "stack", "0", or "0+1+2"
    min: int
    max: int
    default: int | None
    init_index: int
    read_only: bool

    def channel_indexes(self, stack_index: int | None = None) -> list[int]:
        if self.channel == "null":
            return []
        if self.channel == "stack":
            if stack_index is None:
                raise ValueError(f"{self.name} requires a stack_index")
            return [stack_index]
        return [int(c) for c in self.channel.split("+")]


def _parse_table() -> dict[str, Param]:
    params: dict[str, Param] = {}
    for line in _TABLE.strip().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        name, number, channel, lo, hi, default, init_index, read_only = (
            p.strip() for p in line.split(",")
        )
        params[name] = Param(
            name=name,
            number=None if number == "null" else int(number),
            channel=channel,
            min=int(lo),
            max=int(hi),
            default=None if default == "null" else int(default),
            init_index=int(init_index),
            read_only=read_only == "true",
        )
    return params


PARAMS: dict[str, Param] = _parse_table()

INPUT_CHANNEL_IDS = ["analog1", "analog2", "analog3", "analog4", "analog5", "analog6"]
INPUT_CHANNEL_TITLES = ["Analog 1", "Analog 2", "Analog 3", "Analog 4", "Analog 5", "Analog 6"]

AMP_TYPES = ["Clean", "Crunch", "Lead", "Drive"]

# Slider (0-127) -> dBFS lookup, ported verbatim from steinmixer's UR44.js
DBFS_TABLE = [
    float("-inf"), -74, -72, -70, -68, -66, -64, -62, -60, -58, -56, -54, -52,
    -50, -49, -48, -47, -46, -45, -44, -43, -42, -41, -40, -39, -38, -37, -36,
    -35, -34, -33, -32, -31, -30, -29, -28, -27, -26, -25, -24, -23, -22, -21,
    -20, -19.5, -19, -18.5, -18, -17.5, -17, -16.5, -16, -15.5, -15, -14.5,
    -14, -13.5, -13, -12.5, -12, -11.5, -11, -10.5, -10, -9.75, -9.5, -9.25,
    -9, -8.75, -8.5, -8.25, -8, -7.75, -7.5, -7.25, -7, -6.75, -6.5, -6.25,
    -6, -5.75, -5.5, -5.25, -5, -4.75, -4.5, -4.25, -4, -3.75, -3.5, -3.25,
    -3, -2.75, -2.5, -2.25, -2, -1.75, -1.5, -1.25, -1, -0.75, -0.5, -0.25,
    0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5,
    3.75, 4, 4.25, 4.5, 4.75, 5, 5.25, 5.5, 5.75, 6,
]


def dbfs_from_slider_value(value: int) -> float:
    return DBFS_TABLE[value]
