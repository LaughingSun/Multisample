//-------------------------------------------------------------------
//    SCRIPT NAME:      Multisample
//    Internal version: 0.9f
//    AUTHOR:           Joost Ridderbos
// 	  Git hashkey: 		"value"
//    Copyright 2013-2015 Joost Ridderbos
//-------------------------------------------------------------------

//    This program is free software: you can redistribute it and/or modify
//    it under the terms of the GNU General Public License as published by
//    the Free Software Foundation, either version 3 of the License, or
//    (at your option) any later version.

//    This program is distributed in the hope that it will be useful,
//    but WITHOUT ANY WARRANTY; without even the implied warranty of
//    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//    GNU General Public License for more details.

//    You should have received a copy of the GNU General Public License
//    along with this program.  If not, see <http://www.gnu.org/licenses/>.
 
// Future plans (- = open, V = fixed, T = needs testing):
// - Add WF min/max to markers
// V Change procedure text/behaviour
// V Add dynamic WF size compatbility 
// -	--> Working areas?
// - Build in more abort buttons
// - Drive z motor to 10.000 after patterning finishes
// V Add check for design pathlength limit of 100 chars
// V Allow for aperture/voltage change
// 		T-> Save WF parameters per beam setting
//		V-> Save and load column parameters
//		V-> Load dataset from positionlist
// V Add options to read everything except UV alignment from file
// V Separate markertypes/procedures in separate files (for editing by users)
// - Add more checks for user input
// - Add time estimation calculation
// - Add logdata:
//		V Layer61 scan results
//		-> Progress bar (together with time estimation)
// V Fix SetSvars function
// - Add comments :)
// - Add initialisation to check if all files are present
// - Set original magnifiction after AutoWFalign
// - Sort order of writing chip by aperture size
// V Fix GDSII layer 61 scan InstallWF. Use functionality from QDAuto113
// V Add stepsicdze/beamcurrent to S[5][x][i] column and improve functionality
// 		V-> Also add to Load and Log function
// - Add ability to do only a GDSII scan on the first device on a sample (one UV alignment)
// - Add ability to load writematrix from file (for unevenly spaced devices on a sample)
// 		-> Combine this with loading different designs/layers per UV alignment
// V Remove reset UV alignment for first sample
// - Add comment to load new design
// - Add procedure for manual alignment per chip
// V Add WFalignment on first sample on the chip only
// - Add no-GUI mode for using patterning in Plist
// V Add improved beamcurrent measurement
// - Add checks for proper procedure naming or stop using capital letters..
// - Add notifications when finished to file (on swapdrive)

// Maybe later:
// - Make separate capture UV/WF script
// - Expand on alignprocedures syntax
// - Split logfiles into sampledata, markerlog and progress log
// - Redo sampledefinitions in multisample/sdvars. Make them not rely on numbers but use loadlist maybe.

// BUGS:
// V Collect UV measurement of beamcurrent with measbcflag is broken!
// V An extra empty logfile is created somewhere in the script.
// V Auto stepsizedwelltime does not work, always uses 2 nm
//		V It is possible to change the value for the stepsize in multisample.txt
//		V In this case, the beamspeed reported in the log is wrong
// V Possibly the WF loading does not work properly, needs testing!
//		V Without changing beam settings, program works fine
// V Layer 61 scans do not work for this version.
// - Probably more :/
// - Manual alignment on dot within script not possible
// 		-> Needs added routine during UV alignment.

var Gsn = "Multisample";
//var Gsnl = parseInt(Gsn.length, 8);
var Gfilepath = ExpandPath("%userroot%\Script\\" + Gsn + "\\");
var Glogfilename = createArray(3);
Glogfilename[1] = Gfilepath + "Logs\\";
var Glib = Gfilepath + "\\Lib\\";
var Gsampleini = App.OpenInifile(Gfilepath + "Multisample.txt");
var GSDini = App.OpenInifile(Gfilepath + "SDvars.txt");
var GMarkertypes = App.Openinifile(Gfilepath + "Markers.txt");
var GGDSIImarkertypes = App.Openinifile(Gfilepath + "GDSIImarkers.txt");
var GAlignprocedures = App.Openinifile(Gfilepath + "Alignprocedures.txt");
var Gdatesp = Date().split(":");
var S = createArray(1,1,1);
var Gnums = -1;
var Gmeasbcflag = 1;
var i, st, beamoffflag, collectinguvflag;

function Succes()			                                            //-- Called if function 'write' was successful
{
   Install(1);
   Stage.JoystickEnabled = true;                                        //Turns joystick back on
   App.SetFloatVariable("AlignWriteField.AutoMarksFailed", 0);          //Resets failed automarks counter
   App.SetVariable("Adjust.MinAutoMarks","3");                          //Resets MinAutoMarks back to 3 (from 2)
   App.SetVariable("Exposure.ExposureLoops","1"); 						//Let's be nice to the default settings
   App.ErrMsg(EC_INFO, 0, "Great Succes!");                             //Displays success message ;) (as long as you don't correct the spelling in the message)
}

function isEven(n)														//Function to check if number is odd or even
{
	if (parseInt(n, 8)%2 !==0)
	{
		n = 0;
	}
	else
	{
		n = 1;
	}
	return n;
}

function ReplaceAtbymu(str)
{
	str = str.replace(/@/g, "\u00B5");
	return str;
}

function PreciseRound(num, decimals) 
{
	var t=Math.pow(10, decimals);   
 	return (Math.round((num * t) + (decimals)*((10 / Math.pow(100, decimals)))) / t).toFixed(decimals);
 }

function LastDatasettoColset()
{
	var dataset, splitdataset, splitdataset2, partonecolset, parttwocolset, colset;

	dataset = (App.GetSysVariable("Vicol.LastDataset"));
	splitdataset = dataset.split("(");
	splitdataset2 = splitdataset[1].substring(0, splitdataset[1].length - 1);
	partonecolset = splitdataset2;
	parttwocolset = splitdataset[0].substring(0, splitdataset[0].length - 1);
	colset = partonecolset + ": " + parttwocolset;
	colset = ReplaceAtbymu(colset);
	return colset;
}

function MeasBeamCurrent()												//Measures beam current
{
	var bc, bcf;
	bc = createArray(3);
	if (App.ErrMsg(EC_YESNO, 0, "Do you want to measure the beam current?") == EA_YES)                        //Asks user to perform beam current measurement + dwelltime corrections
    {
    	if ( Column.CheckConnection() )                                   //If answer is YES, measurement is performed
      	{
			Stage.X = -35; 													//Sets stage coörds to 30,30 (saves time when driving back)
		 	Stage.Y = 39; 
		 	Stage.WaitPositionReached(); 
		 	BeamCurrent(false, false);
		 	bc[0] = parseFloat(App.GetVariable("BeamCurrent.BeamCurrent"));
		 	Stage.WaitPositionReached();
         	BeamCurrent(false, false);
         	bc[1] = parseFloat(App.GetVariable("BeamCurrent.BeamCurrent"));
         	Stage.WaitPositionReached();
         	BeamCurrent(false, false);
         	bc[2] = parseFloat(App.GetVariable("BeamCurrent.BeamCurrent"));
         	if	(Math.max(bc[0], bc[1], bc[2])/Math.min(bc[0], bc[1], bc[2]) >= 1.01)
         	{
         		if (App.ErrMsg(4,0,"Beam current fluctuation over three measurements(>1%) (" + bc + " nA). Continue?") == 7)
         		{
         			Abort();
         		}
         	}	
        bcf = ((bc[0]+bc[1]+bc[2])/3);
        bcfdisp = PreciseRound(bcf*Math.pow(10,3),2);
        App.ErrMsg(0,0,"Beamcurrent: " + bcfdisp + "pA"); //Dit moest van Joren. Hij houdt niet van teveel floating.
        bcf = bcf.toString();
        App.SetVariable("BeamCurrent.BeamCurrent", bcf);
        }
    }
}

function SetStepsizeDwelltime(i)
{
   	var stepsizeline_um, stepsize_um, stepsizec_um, beamcurrent;

   	stepsizeline_um = (S[1][6][i]*Math.pow(10,-3));
   	stepsize_um = (S[2][6][i]*Math.pow(10,-3));
   	stepsizec_um = (S[3][6][i]*Math.pow(10,-3));
   	beamcurrent = S[7][6][i];
	App.SetVariable("BeamCurrent.BeamCurrent", beamcurrent);
	App.SetVariable("Variables.MetricStepSize", stepsize_um.toString());               //Sets area stepsize y-direction to defined area stepsize
    App.SetVariable("Variables.MetricLineSpacing", stepsize_um.toString());            //Sets area stepsize x-direction to defined area stepsize
    App.SetVariable("BeamControl.CurveStepSize", stepsizec_um.toString());              //Sets curved element stepsize to defined area stepsize
    App.SetVariable("BeamControl.CurveLineSpacing", stepsizec_um.toString());           //Sets curved line stepsize to defined area stepsize
    App.SetVariable("BeamControl.SplStepSize", stepsizeline_um.toString());            //Sets line stepsize to defined area stepsize
    App.Exec("SetExposureParameter()");                                  //Actually activates the previous defined settings
    App.Exec("CorrectCurvedElementsDwellTime()");                        //Corrects curved elements dwelltimes
    App.Exec("CorrectDotDwelltime()");                                   //Corrects dot dwelltimes
    App.Exec("CorrectSPLDwelltime()");                                   //Corrects line dwelltimes
	App.Exec("CorrectDwelltime()");                                           //Corrects area dwelltimes
}

function StepsizeDwelltime(i,GUIflag, bcreadflag) //GUIflag = 0 means only beamspeeds are calculated and modified. BC and SS are not touched.
{
    var msg_setareastepsize, msg_rounding, msg_setlinestepsize, msg_higherthan, beamspeed, minstepsize, advisedbeamspeed, areaminstepsize, stepsize, stepsizec, stepsizeline, criticalbeamspeed, bflag, beamcurrent;
    msg_setareastepsize = "Set AREA stepsize for patterning in nm";
	msg_rounding = "Will be rounded up to a multiple of ";
	msg_setlinestepsize = "Set LINE stepsize in nm";
	msg_higherthan = "nm: (recommended higher than ";
	
	var nLoops = S[14][4][i];
	var curvedose = 150;
	var dotdose = 0.01;
	var resistsensitivity = 150;
	var linedose = 500;
	
	curvedose = curvedose / nLoops;
	dotdose = dotdose / nLoops;
	resistsensitivity = resistsensitivity / nLoops;
	linedose = linedose / nLoops;

	App.SetVariable("Exposure.CurveDose", curvedose+""); 
	App.SetVariable("Exposure.DotDose",dotdose+"") ;
	App.SetVariable("Exposure.ResistSensitivity",resistsensitivity+"");
	App.SetVariable("Exposure.LineDose",linedose+"");
	App.SetVariable("Exposure.ExposureLoops",nLoops+"");

	if (bcreadflag == 1) 
	{
		beamcurrent = App.GetVariable("BeamCurrent.BeamCurrent"); 			//Beamcurrent [nA]
	}
	else 
	{
		beamcurrent = S[7][6][i];
	}

	minstepsize = App.GetVariable("Beamcontrol.MetricBasicStepSize")*Math.pow(10,3); //Min stepsize in [nm]
	//advisedbeamspeed = beamcurrent*3+8;
	advisedbeamspeed = 10;                                             	//Sets the advised beamspeed in [mm/s]
    areaminstepsize = Math.ceil(beamcurrent/((advisedbeamspeed*Math.pow(10,-5)*App.GetVariable("Exposure.ResistSensitivity")*minstepsize)))*minstepsize; //Calculates advised beamspeed [nm]
	if (GUIflag == 0)
	{
		stepsize = S[2][6][i];
		stepsizeline = S[1][6][i];
		stepsizecurve = S[3][6][i];
	}

	if (GUIflag == 1)
	{
		stepsize = areaminstepsize;
		stepsizeline = minstepsize;
		stepsizecurve = areaminstepsize;
	}

	if (GUIflag == 2)
	{
		stepsize = App.InputMsg(msg_setareastepsize, msg_rounding + minstepsize + msg_higherthan + areaminstepsize + "nm)", areaminstepsize).toString(); //Asks user to set stepsize for patterning
    
    	if (stepsize < minstepsize) stepsize=minstepsize; //If the user set stepsize is smaller than the minimum stepsize, it is return to this minimum value
    	stepsizeline=(minstepsize*Math.ceil(App.InputMsg(msg_setlinestepsize, msg_rounding + minstepsize + "nm:", minstepsize)/(minstepsize))).toString(); //Asks user to set stepsize for patterning
    	if (stepsizeline < minstepsize) stepsizeline = minstepsize; 		//If the user set stepsize is smaller than the minimum stepsize, it is returned to this minimum value
    	stepsizecurve = stepsize;   	        
	}
	                                                                     
	beamspeed = [];
	beamspeed[0] = beamcurrent*Math.pow(10,4)/(App.GetVariable("Exposure.LineDose"));  //Calculates line beamspeed in mm/s
  	beamspeed[1] = beamcurrent*Math.pow(10,5)/(stepsize*App.GetVariable("Exposure.ResistSensitivity")); //Calculates area beamspeed in mm/s                                                                        //Lines below calculate the resulting beam speed based on user stepsize
	beamspeed[2] = beamcurrent*Math.pow(10,5)/(stepsizecurve*App.GetVariable("Exposure.CurveDose")); //Calculates area beamspeed in mm/s 

   	

   	if (GUIflag == 2)
   	{
   	 	criticalbeamspeed = 10;
   		bflag = 0;
   		
   		if (beamspeed[0] > criticalbeamspeed) 
      	{
      		App.Errmsg(EC_INFO ,0 , "WARNING! Line beam speed greater than 10mm/s:    " + Math.ceil(beamspeed[2]*10)/10 + "mm/s, reduce beamcurrent."); 
      		bflag = 1;
      	}      	
   		if (beamspeed[1] > criticalbeamspeed) 
      	{
      		App.Errmsg(EC_INFO ,0 , "WARNING! Area beam speed greater than 10mm/s:    " + Math.ceil(beamspeed[1]*10)/10 + "mm/s, increase stepsize or reduce beamcurrent.");
      		bflag = 1;
      	}
      	//if (beamspeed[2] > critica3	lbeamspeed)                                            //Next lines checks if the calculated beamspeed is not higher than 10 mm/s, else it gives a warning.
      	//{ 
      	//	App.Errmsg(EC_INFO ,0 , "WARNING! Curved Area beam speed greater than 10mm/s: " + beamspeed[0]*1000 + "mm/s, increase stepsize or reduce beamcurrent.");
      	//	bflag = 1;
      	//}

   		if (bflag == 1)                                                      //If one of the beamspeeds was too high, the user is asked if they want to continue anyway.
    	{
	      	if (App.ErrMsg(EC_YESNO, 0, "Continue with high beamspeed? (Okay until ~11 mm/s)" ) == EA_NO) Abort();
	    }
   			bflag = 0; 
   	}
   	stepsizec = stepsize;

   	if (GUIflag != 0)
   	{
   		S[1][6][i] = stepsizeline;
   		S[2][6][i] = stepsize;
   		S[3][6][i] = stepsizec;
   	}
   	
   	S[4][6][i] = PreciseRound(beamspeed[0],3);
   	S[5][6][i] = PreciseRound(beamspeed[1],3);
   	S[6][6][i] = PreciseRound(beamspeed[2],3);
   	S[7][6][i] = PreciseRound(beamcurrent,6);
   	//App.ErrMsg(0,0,"1 - szl:"+S[1][6][i] +stepsizeline+" /sz:"+S[2][6][i]+" /szc:"+S[3][6][i]+" /bsl:"+S[4][6][i]+" /bsa:"+S[5][6][i]+" /bsc:"+S[6][6][i]+" /bc:"+S[7][6][i])
}

function FileExists(filespec)
{
   var fso, s = filespec;
   fso = new ActiveXObject("Scripting.FileSystemObject");
   if (fso.FileExists(filespec))
      s = 1;
   else 
      s = 0;
   return(s);
}

function OriginCorrection()                                             //-- Sets current location as local origin
{
   Stage.LocalAlignment();                       //Switch to local UVW
   Stage.ResetAlignment();                  //Delete previous alignments
   Stage.SetAlignPointUV(1, true, 0, 0);                       //Set UV to 0,0
   Stage.SetAlignPointXY(1, Stage.X, Stage.Y);                       //Define current location in X and Y as alignment point
   App.SetVariable("Autofocus.MarkValid1", "1");
   App.SetVariable("Autofocus.MarkValid2", "1");
   App.SetVariable("Autofocus.MarkValid3", "1");
   Stage.SetAlignment();                       //Perform alignment on this one point
}

function Abort()                                                        //-- Aborts script execution
{                                                                       //For details, check function Succes()
   Install(1);
   Stage.JoystickEnabled = true;
   App.SetVariable("Adjust.MinAutoMarks","3");
   App.SetVariable("Exposure.ExposureLoops","1"); 						//Let's be nice to the default settings
   if (collectinguvflag == 1)
   {
   		Logdata();
   }
   throw new Error('Execution cancelled by user');                      //Interrupts script by trowing error
}

function Detectnums(file, filename, checkflag)
{
	var Gnums2, i, it;
	
	Gnums2 = file.ReadString("GS", "n-Samples", -1);

	if (checkflag == 1)
	{
		for (i = 1; i <= 99; i++)
		{
			it = "S" + i;
			if (file.SectionExists(it)==false )
			{
			Gnums = parseInt(i - 1);
			
			if (Gnums != Gnums2)
				{
					App.ErrMsg(0, 0, "Inconsistency in " + filename + ". Check n-Samples under [GS] and check sample entries.");
					Abort();
				}
			else if	(App.ErrMsg(4, 0, Gnums + " chips are detected. Is this correct?")==7)
				{
					App.ErrMsg(0, 0, "Please do all kinds of stuff to make things not wrong.");
					Abort();
				}
        	return(Gnums);
        	}
		}

	}
	else
	{
		Gnums = Gnums2;
	}
	return Gnums;
}

function ResetPanicbutton()
{
	var panicini;
	
	panicini = App.OpenInifile(Gfilepath + "Panic.txt");
	parseInt(panicini.WriteInteger("Panicswitch","panic",0));
}

function Panicbutton()
{
	var panicini, panicswitch;
	panicini = App.OpenInifile(Gfilepath + "Panic.txt");
	panicswitch = parseInt(panicini.ReadInteger("Panicswitch","panic",0));
	if (panicswitch !== 0)
	{
		App.ErrMsg(0,0,"Panic button initiated. Script execution terminated.");
		Abort();
	}
}

function createArray(length) 
{
    var arr = new Array(length || 0),
        i = length;

    if (arguments.length > 1) {
        var args = Array.prototype.slice.call(arguments, 1);
        while(i--) arr[length-1 - i] = createArray.apply(this, args);
}

    return arr;
}

function CheckPathLength(str, sn)
{
	if (str.length>100)
	{
		App.ErrMsg(0,0,"GDSII datapath for sample " + sn + " is too long (100 characters is max, this path is " + str.length + " characters long), change location or pathnames. The script will abort.");
		Abort();
	}
}

function Load(SDflag)
{	   
    S = createArray(99,7,Gnums+1);
    var inifile, st, it, j, colmode, GDSIIpath;

	//First load the list of parameters applicable to all loaded samples:
	if (SDflag == 0) 
	{
		inifile = Gsampleini;
	}
	if (SDflag == 1) 
	{
		inifile = GSDini;
	}
	
	S[9][4][1] = parseFloat(inifile.ReadString("GS","Procedure", "1"));
	st = S[9][4][1];
	S[11][4][1] = parseFloat(inifile.ReadString("GS","n-Samples", "1"));		
	
    for (i = 1; i <= Gnums; i++)
    {
		it = "S" + i; 
		
	    if (SDflag == 0)
	    {
	    	for (j=1; j <= 3; j++)
			{
				S[1][j][i] = parseFloat(inifile.ReadString(it, "U" + j, "0"));
				S[2][j][i] = parseFloat(inifile.ReadString(it, "V" + j, "0"));
				S[3][j][i] = parseFloat(inifile.ReadString(it, "WD" + j, "0"));
				S[4][j][i] = parseFloat(inifile.ReadString(it, "X" + j, "0"));
				S[5][j][i] = parseFloat(inifile.ReadString(it, "Y" + j, "0"));
				S[6][j][i] = parseFloat(inifile.ReadString(it, "Z" + j, "0"));
				S[7][j][i] = parseFloat(inifile.ReadString(it, "MarkValid" + j, "0"));

				S[5][5][i] = parseFloat(inifile.ReadString(it, "WFZoomU", "0"));
				S[6][5][i] = parseFloat(inifile.ReadString(it, "WFZoomV", "0"));
				S[7][5][i] = parseFloat(inifile.ReadString(it, "WFShiftU", "0"));
				S[8][5][i] = parseFloat(inifile.ReadString(it, "WFShiftV", "0"));
				S[9][5][i] = parseFloat(inifile.ReadString(it, "WFRotU", "0"));
				S[10][5][i] = parseFloat(inifile.ReadString(it, "WFRotV", "0"));	
			}
		}

		if (st == 1)
		{
			S[1][4][i] = (inifile.ReadString("GS","ExpLayers", "0"));
			S[2][4][i] = parseInt(inifile.ReadString("GS", "Nx", "0"));
			S[3][4][i] = parseInt(inifile.ReadString("GS", "Ny", "0"));
			S[4][4][i] = parseFloat(inifile.ReadString("GS", "Sx", "0"));
			S[5][4][i] = parseFloat(inifile.ReadString("GS", "Sy", "0"));
			S[6][4][i] = parseFloat(inifile.ReadString("GS", "UuShift", "0"));			
			S[7][4][i] = parseFloat(inifile.ReadString("GS", "VvShift", "0"));
			S[8][4][i] = inifile.ReadString("GS","Name", "0");
			S[13][4][i] = inifile.ReadString("GS", "WFMethod", "0");
			S[10][4][i] = inifile.ReadString("GS", "Markprocedure", "0");
			S[12][4][i] = inifile.ReadString("GS", "L61", "0"); 
			S[14][4][i] = (inifile.ReadString("GS", "Exposureloops", "1")).toString();
			 
			S[1][5][i] = (inifile.ReadString("GS", "WF", "0"));
			colmode = (inifile.ReadString("GS", "ColMode", "0"));
			S[2][5][i] = ReplaceAtbymu(colmode);
			GDSIIpath = (inifile.ReadString("GS", "GDSII", "0"));
			CheckPathLength(GDSIIpath, i);
			if (FileExists(GDSIIpath) != 1)
			{
				App.ErrMsg(0,0,"Error in Multisample.txt: GDSII file not found. Script will abort.");
				Abort();
			}
			S[3][5][i] = (inifile.ReadString("GS", "GDSII", "0"));
			S[4][5][i] = (inifile.ReadString("GS", "Struct", "0"));
			
			S[1][6][i] = (inifile.ReadString("GS", "SSLine", "0"));
			S[2][6][i] = (inifile.ReadString("GS", "SSArea", "0"));
			S[3][6][i] = (inifile.ReadString("GS", "SSCurve", "0"));
			S[4][6][i] = (inifile.ReadString("GS", "LineBS", "0"));
   			S[5][6][i] = (inifile.ReadString("GS", "AreaBS", "0"));
   			S[6][6][i] = (inifile.ReadString("GS", "CurveBS", "0"));
   			S[7][6][i] = (inifile.ReadString("GS", "BeamCurrent", "0"));
   			StepsizeDwelltime(i, 0, 0); //This calculated and modifies beamspeeds if they are not correct in Multisample.txt or SDvars.txt
		}
  	
		if (st == 2)
		{
			S[1][4][i] = (inifile.ReadString(it, "ExpLayers", "0"));
			S[2][4][i] = parseInt(inifile.ReadString(it, "Nx", "0"));
			S[3][4][i] = parseInt(inifile.ReadString(it, "Ny", "0"));
			S[4][4][i] = parseFloat(inifile.ReadString(it, "Sx", "0"));
			S[5][4][i] = parseFloat(inifile.ReadString(it, "Sy", "0"));
			S[6][4][i] = parseFloat(inifile.ReadString(it, "UuShift", "0"));			
			S[7][4][i] = parseFloat(inifile.ReadString(it, "VvShift", "0"));
			S[8][4][i] = inifile.ReadString(it, "Name", "0");
			S[13][4][i] = inifile.ReadString(it, "WFMethod", "0");
			S[10][4][i] = inifile.ReadString(it, "Markprocedure", "1");
			S[12][4][i] = inifile.ReadString(it, "L61", "0");
			S[14][4][i] = inifile.ReadString(it, "Exposureloops", "1");

			S[1][5][i] = (inifile.ReadString(it, "WF", "0"));
			S[2][5][i] = (inifile.ReadString(it, "ColMode", "0"));
			GDSIIpath = (inifile.ReadString(it, "GDSII", "0"));
			CheckPathLength(GDSIIpath, i);
			if (FileExists(GDSIIpath) != 1)
			{
				App.ErrMsg(0,0,"Error in Multisample.txt: GDSII file not found for sample " + i + ". Script will abort.");
				Abort();
			}
			S[3][5][i] = (inifile.ReadString(it, "GDSII", "0"));
			S[4][5][i] = (inifile.ReadString(it, "Struct", "0"));
			S[1][6][i] = (inifile.ReadString(it, "SSLine", "0"));
			S[2][6][i] = (inifile.ReadString(it, "SSArea", "0"));
			S[3][6][i] = (inifile.ReadString(it, "SSCurve", "0"));
			S[4][6][i] = (inifile.ReadString(it, "LineBS", "0"));
   			S[5][6][i] = (inifile.ReadString(it, "AreaBS", "0"));
   			S[6][6][i] = (inifile.ReadString(it, "CurveBS", "0"));
   			S[7][6][i] = (inifile.ReadString(it, "BeamCurrent", "0"));
   			StepsizeDwelltime(i, 0, 0); //This calculated and modifies beamspeeds if they are not correct in Multisample.txt or SDvars.txt	
		}
	}	
	
	if (SDflag == 0)
	{
		if (App.ErrMsg(4, 0,"Multisample.txt successfully loaded. Use pre-set beamcurrent and stepsize?") == 7)
		{

    		if (st == 1)
			{
				App.ErrMsg(0, 0, "Column parameters will be activated. Measure beamcurrent and modify stepsizes.");
				Panicbutton();
				SetSvars(1, 1, 1);
				Panicbutton();
				MeasBeamCurrent();
	    		StepsizeDwelltime(1, 2, 1);
	    		SetStepsizeDwelltime(1);
			}

    		if (st == 2)
    		{
    			App.ErrMsg(0, 0, "Column parameters will be sequentially activated for all samples. Measure beamcurrents and modify stepsizes.");
    			for (i = 1; i <= Gnums; i++)
    			{			
	    			Panicbutton();
	    			SetSvars(i, 1, 1);
	    			App.ErrMsg(0, 0, "Settings for sample " + i + " are now activated.");
	    			Panicbutton();
					if (i == 1) 
					{
						MeasBeamCurrent();
					}				
					else
					{
						if (S[2][5][i] != S[2][5][i-1]) MeasBeamCurrent();	
					}
					StepsizeDwelltime(i, 2, 1);
					SetStepsizeDwelltime(i);			
				}    			
    		}
    		
		}
 	}
	else
	{
		if (App.ErrMsg(4, 0,"SDvars.txt successfully loaded. Use pre-set beamcurrent and stepsize?") == 6)
		{
			Gmeasbcflag = 0;
		}
		CollectUV(st, 2);  //After loading SDvars.txt, start collection of UV coords. Set GUIflag = 2 since all other variables are already loaded.	
	}
    return(S);
}


function CollectSD(st, GUIflag)
{
    var mflag = 0;
	var i, it, wfprocedureloadlist, S14, S24, S34, S44, S54, S64, S74, S84, S94, S104, S124, S134, S144, S15, S25, S35, S45, currpath, fex, currstruct, tl;
	var GDSmarklist, GDSmark;
	collectinguvflag = 1;
	Gnums = App.InputMsg("Select amount of UV alignments (one additional alignment requirement per column change)", "Select a number 1-99", "1");
    S = createArray(99,7,Gnums+1);

	if (Gnums != parseInt(Gnums) || Gnums > 99 || Gnums < 1)
	{
		App.ErrMsg(0,0,"Input is no integer or > 99.");
		Abort();
	}
	
	for (i = 1; i <= Gnums; i++)   
	{
		it = "chip " + i;
		
		if (i <= Gnums && mflag == 0)
		{
				
			//if (mflag == 1) break;
			if (st == 1) App.Errmsg(0,0, "Enter data for all used chips in the following dialogue boxes.");
			if (st == 2) App.Errmsg(0,0, "Enter data for " + it + " in the following dialogue boxes.");
			Panicbutton();
			S84 = App.InputMsg("Sample name","Enter name for sample(s) (for log)","");
			
			if (GUIflag == 2)
			{
				currpath = App.GetVariable("GDSII.Database");
				fex = 0;
				while (fex != 1)
				{
					S35 = App.InputMsg("Select GDSII database file.", "Enter the full path", currpath);
					CheckPathLength(S35, i);
					if (S35 == "") Abort();
					fex = FileExists(S35);
					
					if (fex != 1)
					{
						App.Errmsg(0,0,"Please enter correct path");
					}
				}
				currstruct = App.GetVariable("Variables.StructureName");
				S45 = App.InputMsg("Choose structure", "Type the name of the structure (case sensitive):", currstruct);
				if (S45 == "") S45 = currstruct;

		    	S15 = App.InputMsg("Choose writefield in µm", "Select 1000, 200, 100, 50, 25 or 1", S15);
				S25 = App.InputMsg("Column settings", "Type name of column dataset (format= group: name). You can use '@' for '\u03BC' symbol.", LastDatasettoColset());
				S25 = ReplaceAtbymu(S25);
    		}
			
			S134 = App.Inputmsg("Select type of WF alignment","1: All devices, 2: First device per sample, 3: Manual per chip, 4: No alignment", "1");
			Panicbutton();
			if (S134 ==  1 || S134 == 2 )
			{
				wfprocedureloadlist = GAlignprocedures.ReadString("LoadList", "load", "0").split(";");
				S104 = App.InputMsg("Select AutoWFAlign scan procedure", "Select: " + wfprocedureloadlist, wfprocedureloadlist[0]);
			}
			else
			{
				S104 = -1;
			}
			Panicbutton();
			if (App.ErrMsg(4,0,"Do you want to use layer 61 (GDSII autoscans)?")==EA_YES)
			{
				tl = App.InputMsg("Select layer", "Select layer(s) to use together with layer 61 (separate by ';')","");
				Panicbutton();
				GDSmarklist = GGDSIImarkertypes.ReadString("LoadList", "load", "0");
				GDSmark = App.InputMsg("Select GDSII marker", "Choose: " + GDSmarklist, GDSmarklist[0]);
				Panicbutton();
				S124 = GDSmark + "-" + tl;
				if (App.ErrMsg(4,0,"Do you want to write other layers in a global alignment?")==EA_YES)
				{
					S14 = App.InputMsg("Choose layers", "Select (separate by ';') ", "0");
				}
				else
				{
					S14 = -1;
				}
				Panicbutton();
			}
			else
			{
				S124 = -1;
				S14 = App.InputMsg("Choose layers", "Select layers to write (separate by ';') ", "0");
			}
			S24 = App.InputMsg("Define chip dimensions in x (U)", "Select number of structures: x (U)", "2");
			S34 = App.InputMsg("Define chip dimensions in y (V)", "Select number of structures: y (V)", "2");
			Panicbutton();
			S44 = App.InputMsg("Define structure spacing in (U)", "Select structure spacing in mm: x (U)", "5");
			S54 = App.InputMsg("Define structure spacing in (V)", "Select structure spacing in mm: y (V)", "5");
			Panicbutton();
			S64 = App.InputMsg("Define Global-Local shift (U) for 1st structure", "Select shift in mm: x (U)", "0");
			S74 = App.InputMsg("Define Global-Local shift (V) for 1st structure", "Select shift in mm: v (V)", "0");
			Panicbutton();
			S144 = App.InputMsg("Number of exposureloops per device","#", "1");
			Panicbutton();
			//S44 = 5;
			//S54 = 5;
			//S64 = 0;
			//S74 = 0;
			S94 = st;
				
			if (st == 1) mflag = 1;
				
		}
		S[1][4][i] = S14 + "";
		S[2][4][i] = parseInt(S24);
		S[3][4][i] = parseInt(S34);
		S[4][4][i] = parseFloat(S44);
		S[5][4][i] = parseFloat(S54);
		S[6][4][i] = parseFloat(S64);
		S[7][4][i] = parseFloat(S74);
		S[8][4][i] = S84;
		S[10][4][i] = S104;
		S[12][4][i] = S124 + "";
		S[13][4][i] = S134 + "";
		S[1][5][i] = S15 + "";	
		S[14][4][i] = parseInt(S144);
		//Add a list of parameter that are always applicable to all loaded samples.
		if (i==1)
		{
			S[9][4][1] = parseFloat(S94);
			S[11][4][1] = Gnums;	
		}
		
			
		if (GUIflag == 2)
		{
		S[1][5][i] = S15 + "";
		S[2][5][i] = S25 + "";
		S[3][5][i] = S35;
		S[4][5][i] = S45;
		Logdata();
		}
	}
	S = CollectUV(st, GUIflag);

	return(S);
}

function CollectUV(st, GUIflag)
{
	var i, j, m, maf, wd;
// Add loop so that this is only asked once if st == 1
    if (GUIflag == 1)
    {	
    	App.ErrMsg(0,0,"Collecting three point alignments for all chips commences. Activate desired Column dataset and WriteField. USE GLOBAL ALIGNMENT!");
	}

	if (GUIflag == 2)
    {	
    	App.ErrMsg(0,0,"Collecting three point alignments for all chips commences. USE GLOBAL ALIGNMENT!");
	}
	Panicbutton();
	for (i = 1; i <= Gnums; i++)
    {
		Stage.GlobalAlignment();
		if (i != 1) Stage.ResetAlignment();

	    if (GUIflag == 1)
		{
			if (App.ErrMsg(8,0,"Perform UV alignment on sample chip " + i + " of " + Gnums + ". The now opened GDSII file and structure are logged and used for exposure.") == 2)
			{
				Logdata();
				Abort();
			}
			Panicbutton();
		}
		if (GUIflag == 2)
		{
			SetSvars(i, 0, 0);
			App.Exec("OpenDatabase(" + S[3][5][i] + ")");
			App.Exec("ViewStructure(" + S[4][5][i] + ")");


			if (App.ErrMsg(8,0,"Column and writefield set, now perform UV alignment on sample chip " + i + " of " + Gnums + ".") == 2)
			{
				Logdata();
				Abort();
			}
			Panicbutton();		
		}

	    App.Exec("Halt()");
	    Panicbutton();
	    if (S[13][4][i] == 1 || S[13][4][i] == 2)
		{
			AlignWF(S[10][4][i], 0, 1, 1, 1); //align a writefield or not depending on S[10][4][i]
		}	
		if (S[13][4][i] == 3)
		{	
		 // fix this to be compatble with manual WF alignment	
		}	    

	    App.ErrMsg(0,0,"Check UV alignment + focus after WF change of sample chip " + i + " of " + Gnums);
	    App.Exec("Halt()");
	    Panicbutton();
	    if (Gmeasbcflag == 1)
	    {
	    	if (st == 1 && i == 1) 
	    	{
	    		MeasBeamCurrent();
	    		StepsizeDwelltime(i, GUIflag, 1);
		    	SetStepsizeDwelltime(i);
	    	}
	    	if (st == 1 && i != 1) 
	    	{
	    		S[1][6][i] = S[1][6][1]
	    		S[2][6][i] = S[2][6][1]
	    		S[3][6][i] = S[3][6][1]
	    		S[4][6][i] = S[4][6][1]
	    		S[5][6][i] = S[5][6][1]
	    		S[6][6][i] = S[6][6][1]
	    		S[7][6][i] = S[7][6][1]
	    	}
			if (st == 2 && i == 1) MeasBeamCurrent();
			if (st == 2 && i !=1)
			{
				lastcolset = LastDatasettoColset();
				if (lastcolset != S[2][5][i-1]) MeasBeamCurrent();
			}
			if (st == 2) 
  			{
   				StepsizeDwelltime(i, GUIflag, 1);
				SetStepsizeDwelltime(i);
  			}

	    }

	    for (j = 1; j <= 3; j++)
		{
			m = App.GetVariable("GLOBALADJUST.Mark" + j).split(",");
			maf = App.GetVariable("AUTOFOCUS.Mark" + j).split(",");
			wd = App.GetVariable("AUTOFOCUS.WD" + j);

			S[1][j][i] = parseFloat(m[1]);
			S[2][j][i] = parseFloat(m[2]);
			S[3][j][i] = wd + "";
			S[4][j][i] = parseFloat(m[3]);
			S[5][j][i] = parseFloat(m[4]);
			S[6][j][i] = maf[2] + "";
			S[7][j][i] = parseFloat(m[0]);
	    }

		if (GUIflag == 1)
		{
			S[1][5][i] = parseInt(App.GetVariable("Variables.WritefieldHeight"));
			S[2][5][i] = LastDatasettoColset();
			S[3][5][i] = App.GetVariable("GDSII.Database");
			S[4][5][i] = App.GetVariable("Variables.StructureName");
		}
		
		App.Exec("GetCorrection()");
		S[5][5][i] = App.GetVariable("Variables.ZoomX");
		S[6][5][i] = App.GetVariable("Variables.ZoomY");
		S[7][5][i] = App.GetVariable("Variables.ShiftX");
		S[8][5][i] = App.GetVariable("Variables.ShiftY");
		S[9][5][i] = App.GetVariable("Variables.RotX");
		S[10][5][i] = App.GetVariable("Variables.RotY");
		Logdata();
	}
    collectinguvflag = 0;
    return (S);
}

function Logdata()
{
	var datesp, date, Glogini, it, j; 

	st = S[9][4][1];
    date = Gdatesp[0] + "." + Gdatesp[1] + "." + Gdatesp[2];
	Glogfilename[2] = "Log " + date + ".txt";
    Glogini = App.OpenInifile(Glogfilename[1] + Glogfilename[2]);
	Glogini.Writestring("GS","Procedure", S[9][4][1]);
	Glogini.Writestring("GS","n-Samples", S[11][4][1]);
	
	if (st == 1)
	{
	    Glogini.WriteString("GS", "ExpLayers", S[1][4][1] + "");
	    Glogini.WriteString("GS", "Nx", S[2][4][1] + "");
	    Glogini.WriteString("GS", "Ny", S[3][4][1] + "");
	    Glogini.WriteString("GS", "Sx", S[4][4][1] + "");
	    Glogini.WriteString("GS", "Sy", S[5][4][1] + "");
		Glogini.WriteString("GS", "UuShift", S[6][4][1] + "");
		Glogini.WriteString("GS", "VvShift", S[7][4][1] + "");
		Glogini.Writestring("GS", "Name", S[8][4][1]);
		Glogini.Writestring("GS", "WFMethod", S[13][4][1] + "");
		Glogini.Writestring("GS", "Markprocedure", S[10][4][1]);
		Glogini.Writestring("GS", "L61", S[12][4][1]);	
		Glogini.Writestring("GS", "Exposureloops", S[14][4][1]);	
		
		Glogini.WriteString("GS", "WF", S[1][5][1] + "");
		Glogini.WriteString("GS", "ColMode", S[2][5][1] + "");
		Glogini.WriteString("GS", "GDSII", S[3][5][1] + "");
		Glogini.WriteString("GS", "Struct", S[4][5][1] + "");
		
		Glogini.WriteString("GS", "SSLine", S[1][6][1] + "");
		Glogini.WriteString("GS", "SSArea", S[2][6][1] + "");
		Glogini.WriteString("GS", "SSCurve", S[3][6][1] + "");
		Glogini.WriteString("GS", "LineBS", S[4][6][1] + "");
		Glogini.WriteString("GS", "AreaBS", S[5][6][1] + "");
		Glogini.WriteString("GS", "CurveBS", S[6][6][1] + "");
		Glogini.WriteString("GS", "BeamCurrent", S[7][6][1] + "");
	}	

    for (i = 1; i <= Gnums; i++)
    {
        it = "S" + i; 
		if (st == 2)
		{	
			Glogini.WriteString(it, "ExpLayers", S[1][4][i] + "");
			Glogini.WriteString(it, "Nx", S[2][4][i] + "");
			Glogini.WriteString(it, "Ny", S[3][4][i] + "");
			Glogini.WriteString(it, "Sx", S[4][4][i] + "");
			Glogini.WriteString(it, "Sy", S[5][4][i] + "");
			Glogini.WriteString(it, "UuShift", S[6][4][i] + "");
			Glogini.WriteString(it, "VvShift", S[7][4][i] + "");
			Glogini.Writestring(it,"Name", S[8][4][i]);
			Glogini.Writestring(it, "WFMethod", S[13][4][i] + "");
			Glogini.Writestring(it,"Markprocedure", S[10][4][i]);	
			Glogini.Writestring(it, "L61", S[12][4][i]);
			Glogini.Writestring(it, "Exposureloops", S[14][4][i]);	
			
			Glogini.WriteString(it,"WF", S[1][5][i] + "");
			Glogini.WriteString(it,"ColMode", S[2][5][i] + "");
			Glogini.WriteString(it,"GDSII", S[3][5][i] + "");
			Glogini.WriteString(it,"Struct", S[4][5][i] + "");

			Glogini.WriteString(it, "SSLine", S[1][6][i] + "");
			Glogini.WriteString(it, "SSArea", S[2][6][i] + "");
			Glogini.WriteString(it, "SSCurve", S[3][6][i] + "");
			Glogini.WriteString(it, "LineBS", S[4][6][i] + "");
			Glogini.WriteString(it, "AreaBS", S[5][6][i] + "");
			Glogini.WriteString(it, "CurveBS", S[6][6][i] + "");
			Glogini.WriteString(it, "BeamCurrent", S[7][6][i] + "");
		}
		
		for (j = 1; j <= 3; j++)
		{	          
			Glogini.WriteString(it, "U" + j, S[1][j][i] + "");
			Glogini.WriteString(it, "V" + j, S[2][j][i] + "");
			Glogini.WriteString(it, "WD" + j, S[3][j][i] + "");
			Glogini.WriteString(it, "X" + j, S[4][j][i] + "");
			Glogini.WriteString(it, "Y" + j, S[5][j][i] + "");
			Glogini.WriteString(it, "Z" + j, S[6][j][i] + "");
			Glogini.WriteString(it, "MarkValid" + j, S[7][j][i] + "");
		}
		
		Glogini.WriteString(it, "WFZoomU", S[5][5][i] + "");
		Glogini.WriteString(it, "WFZoomV", S[6][5][i] + "");
		Glogini.WriteString(it, "WFShiftU", S[7][5][i] + "");
		Glogini.WriteString(it, "WFShiftV", S[8][5][i] + "");
		Glogini.WriteString(it, "WFRotU", S[9][5][i] + "");
		Glogini.WriteString(it, "WFRotV", S[10][5][i] + "");		
	}	
    return(Glogfilename);
}

function AlignUV(i)
{
	Stage.ResetAlignment(); 
	Stage.GlobalAlignment();
	Stage.SetAlignPointUV(1, S[7][1][i], S[1][1][i], S[2][1][i])     ; 
	Stage.SetAlignPointXY(1, S[4][1][i], S[5][1][i])   ; 
	Stage.SetAlignPointUV(2, S[7][2][i], S[1][2][i], S[2][2][i])     ;  
	Stage.SetAlignPointXY(2, S[4][2][i], S[5][2][i])   ;                      
	Stage.SetAlignPointUV(3, S[7][3][i], S[1][3][i], S[2][3][i])     ; 
	Stage.SetAlignPointXY(3, S[4][3][i], S[5][3][i])   ;

	App.SetVariable("VIMOT.Autofocus", "ON");
	App.SetVariable("Autofocus.CorrectFocus", "ON");
	App.SetVariable("Autofocus.Mark1", S[4][1][i] + "," + S[5][1][i] + "," + S[6][1][i]);
	App.SetVariable("Autofocus.Mark2", S[4][2][i] + "," + S[5][2][i] + "," + S[6][2][i]);
	App.SetVariable("Autofocus.Mark3", S[4][3][i] + "," + S[5][3][i] + "," + S[6][3][i]);
	App.SetVariable("Autofocus.MarkValid1", S[7][1][i]);
	App.SetVariable("Autofocus.MarkValid2", S[7][2][i]);
	App.SetVariable("Autofocus.MarkValid3", S[7][3][i]);
	App.SetVariable("Autofocus.WD1", S[3][1][i] + "");
	App.SetVariable("Autofocus.WD2", S[3][2][i] + "");
	App.SetVariable("Autofocus.WD3", S[3][3][i] + "");
 
	App.SetVariable("LOCALAUTOFOCUS.Mark1", S[4][1][i] + "," + S[5][1][i] + "," + S[6][1][i]);
	App.SetVariable("LOCALAUTOFOCUS.Mark2", S[4][2][i] + "," + S[5][2][i] + "," + S[6][2][i]);
	App.SetVariable("LOCALAUTOFOCUS.Mark3", S[4][3][i] + "," + S[5][3][i] + "," + S[6][3][i]); 
	App.SetVariable("LOCALAUTOFOCUS.MarkValid1", S[7][1][i]);
	App.SetVariable("LOCALAUTOFOCUS.MarkValid2", S[7][2][i]);
	App.SetVariable("LOCALAUTOFOCUS.MarkValid3", S[7][3][i]); 
	App.SetVariable("LOCALAUTOFOCUS.WD1", S[3][1][i] + "");
	App.SetVariable("LOCALAUTOFOCUS.WD2", S[3][2][i] + "");
	App.SetVariable("LOCALAUTOFOCUS.WD3", S[3][3][i] + "");   

	Stage.SetAlignment();
}

function Install(restoreflag)
{
	var fso, p1 , p2;
	App.SetVariable("Automation/Links.0",Gfilepath + Gsn + ".js");
	fso = new ActiveXObject("Scripting.FileSystemObject");
	if (fso.FolderExists(Gfilepath))
	{
	}
	else
	{
		fso.CreateFolder(Gfilepath);
	}
	p1 = ExpandPath("%userroot%\\Record\\ScanMacros\\");
	fso.CopyFile(Glib + "Multisample WF align.rec", p1, true);
	p2 = ExpandPath("%root%\\Lib\\System\\");
	if (restoreflag == 1)
	{
		fso.CopyFile(Glib + "AlignWForg\\AlignWFAuto.js", p2, true);
	}
	else
	{
		fso.CopyFile(Glib + "AlignWFAuto.js", p2, true);
	}
	fso.close;
}

function RemoveGDSlogflag()
{
	p3 = ExpandPath("%userroot%\\System\\");
	scanini = App.OpenIniFile(p3 + "Scan.ini");
	scanini.WriteString("Interact", "log", 0);
}	

function InstallGDSmarker(markertype, k, mj) //Installs GDSII marker properties into system.
{
	var GDSmarkertypes, n, m, q, p3, WFalignini, parlist, scanini, par;
	GDSmarkertypes = LoadGDSIIMarkers();
	for (n = 0; n < GDSmarkertypes.length; n++)
	{
		if (GDSmarkertypes[n][0] == markertype) 
		{
			m = n;
			break;
		}
	}

	p3 = ExpandPath("%userroot%\\System\\");
	WFalignini = App.OpenIniFile(Glib + "GDSII Linescan.ini");
	parlist = WFalignini.ReadSection("Automatic procedure during exposure").split(",");
	scanini = App.OpenIniFile(p3 + "Scan.ini");
	scanini.DeleteSection("Automatic procedure during exposure");
	for (q = 0; q < parlist.length; q ++) 
	{
		par = WFalignini.ReadString("Automatic procedure during exposure", parlist[q], "0");
		scanini.WriteString("Automatic procedure during exposure", parlist[q], par);
	}
	scanini.WriteString("Interact", "log", GDSmarkertypes[m][8]);
	scanini.WriteString("Interact", "path", Gfilepath);
	scanini.WriteString("Interact", "logfile", Glogfilename[1] + Glogfilename[2]);
	scanini.WriteString("Interact", "sample_n", i)
	scanini.WriteString("Interact", "nx", k);
	scanini.WriteString("Interact", "ny", mj);

	App.SetVariable("AlignScans.AvgPoints", GDSmarkertypes[m][2]);                    //Sets the number of points in the y-direction
    App.SetVariable("AlignScans.Scanpoints", GDSmarkertypes[m][1]);                 //Sets the number of points in the x-direction
    App.Setvariable("AlignScans.Avg", GDSmarkertypes[m][3]);                          //Sets the number of measurements to average over to obtain one point
	

	var iniTest = App.OpenIniFile(ExpandPath("%userroot%\\System\\LineScanFilter.ini"));//Opens .ini file threshold algorithm            
    
	if (iniTest)                                                     //Loop deletes previous entry and enters 'threshold' in Writefield Alignment
    { 
        if ( iniTest.SectionExists("Threshold")==true )                //If the header Threshold is found, it is deleted
        iniTest.DeleteKey("Threshold", "Align write field"); 
        iniTest.WriteString("Threshold", "Align write field", GDSmarkertypes[m][7]);//The new values are entered from string 'threshold'  
    }

}

function InstallWFAlign(threshold) //Installs markerproperties into systems Scan.ini, called from AutoWFAlign
{	
	var p3, WFalignini, par, parlist, scanini, q; 
	p3 = ExpandPath("%userroot%\\System\\");

	WFalignini = App.OpenIniFile(Glib + "Multisample WF align.ini");
	parlist = WFalignini.ReadSection("Multisample WF align").split(",");
	scanini = App.OpenIniFile(p3 + "Scan.ini");
	scanini.DeleteSection("Multisample WF align");
	for (q = 0; q < parlist.length; q ++) 
	{
		par = WFalignini.ReadString("Multisample WF align", parlist[q], "0");
		scanini.WriteString("Multisample WF align", parlist[q], par);
	}

	var iniTest = App.OpenIniFile(ExpandPath("%userroot%\\System\\LineScanFilter.ini"));//Opens .ini file threshold algorithm            
    
	if (iniTest)                                                     //Loop deletes previous entry and enters 'threshold' in Writefield Alignment
    { 
        if ( iniTest.SectionExists("Threshold")==true )                //If the header Threshold is found, it is deleted
        iniTest.DeleteKey("Threshold", "Align write field"); 
        iniTest.WriteString("Threshold", "Align write field", threshold);//The new values are entered from string 'threshold'  
    }
	
	App.Exec("ResetModule(Scan Manager)");
}

function LoadGDSIIMarkers()
{
	var GDSmarkertypes, loadlist, q, p, parlist, markerdata;
	loadlist = GGDSIImarkertypes.ReadString("LoadList", "load", "0").split(";");
	GDSmarkertypes = createArray(loadlist.length,20);
	for (q = 0; q < loadlist.length; q ++) 
	{
		parlist = new Array("ScanpointsLength","ScanpointsWidth","Averaging","MarkerWidth","WidthTolerance","ContrastThresholdLow","ContrastThresholdHigh","Profile", "Log");
		markerdata = new Array(parlist.length);
		for (p = 0; p < parlist.length; p ++) 
		{
			markerdata[p] = GGDSIImarkertypes.ReadString(loadlist[q], parlist[p], "undefined");

			if (markerdata[p] == "undefined") 
			{
    			App.ErrMsg(0,0,"Markertype '" + loadlist[q] + "' not configured properly. Check Markers.txt and restart script.");
    			Abort();
			}
		}
		GDSmarkertypes[q][0] = loadlist[q]; 
		GDSmarkertypes[q][1] = markerdata[0]; //ScanpointsLength
		GDSmarkertypes[q][2] = markerdata[1]; //ScanpointsWidth
		GDSmarkertypes[q][3] = markerdata[2]; //Averaging
		GDSmarkertypes[q][4] = markerdata[3]; //Markerwidth
		GDSmarkertypes[q][5] = Math.ceil((markerdata[3]*1 - markerdata[4]*markerdata[3])*1000);//Profile min
		GDSmarkertypes[q][6] = Math.ceil((markerdata[3]*1 + markerdata[4]*markerdata[3])*1000);//Profile max
		GDSmarkertypes[q][7] = "Mode:0,L1:" + markerdata[5] + ",L2:" + markerdata[6] + ",Profile:" + markerdata[7] + ",Min:" + GDSmarkertypes[q][5] + ",Max:" + GDSmarkertypes[q][6] + ",LFL:0,RFL:1,LNo:1,RNo:1,LeftE:0.5,RightE:0.5,DIS:0,ZL:0,ZR:0";//threshold
		GDSmarkertypes[q][8] = markerdata[8];
	}
	return GDSmarkertypes;
}

function LoadMarkers()
{
	var Markertypes, loadlist, q, p, parlist, markerdata;
	loadlist = GMarkertypes.ReadString("LoadList", "load", "0").split(";");
	Markertypes = createArray(loadlist.length,20);

	for (q = 0; q < loadlist.length; q ++) 
	{
		parlist = new Array("CenterU","CenterV","MarkerWidth","MarkerLengthU","MarkerLengthV","CenterScanOffset","ScanLength","ScanWidth","ScanAccuracy","WidthTolerance","ContrastThresholdLow","ContrastThresholdHigh","Profile");
		markerdata = new Array(parlist.length);
		for (p = 0; p < parlist.length; p ++) 
		{
			markerdata[p] = GMarkertypes.ReadString(loadlist[q], parlist[p], "undefined");

			if (markerdata[p] == "undefined") 
			{
    			App.ErrMsg(0,0,"Markertype '" + loadlist[q] + "' not configured properly. Check Markers.txt and restart script.");
    			Abort();
			}
		}
		Markertypes[q][0] = loadlist[q]; 
		Markertypes[q][1] = markerdata[0]; //Upos
		Markertypes[q][2] = markerdata[1]; //Vpos
		Markertypes[q][3] = markerdata[6]; //SizeU (actually ScanLength)
		Markertypes[q][4] = markerdata[7]; //SizeV (actually ScanWidth)

		if (markerdata[6]*markerdata[8]/App.GetVariable("Beamcontrol.MetricBasicStepSize") >= 4080) //StepU
		{
			Markertypes[q][5] = Math.ceil((markerdata[6]/4080)/App.GetVariable("Beamcontrol.MetricBasicStepSize"))*App.GetVariable("Beamcontrol.MetricBasicStepSize");
		}
		else
		{
			Markertypes[q][5] = Math.ceil(App.GetVariable("Beamcontrol.MetricBasicStepSize")/(markerdata[8]*App.GetVariable("Beamcontrol.MetricBasicStepSize")))*App.GetVariable("Beamcontrol.MetricBasicStepSize");
		
		}
		if (markerdata[7]*markerdata[8]/App.GetVariable("Beamcontrol.MetricBasicStepSize") >= 4080) //StepV
		{
			Markertypes[q][6] = Math.ceil((markerdata[7]/4080)/App.GetVariable("Beamcontrol.MetricBasicStepSize"))*App.GetVariable("Beamcontrol.MetricBasicStepSize");
		}
		else
		{
			Markertypes[q][6] = Math.ceil(App.GetVariable("Beamcontrol.MetricBasicStepSize")/(markerdata[8]*App.GetVariable("Beamcontrol.MetricBasicStepSize")))*App.GetVariable("Beamcontrol.MetricBasicStepSize");
		}
		Markertypes[q][7] = markerdata[6]/Markertypes[q][5]; //PointsU
		Markertypes[q][8] = markerdata[7]/Markertypes[q][6]; //PointsV
		Markertypes[q][9] = Math.ceil(markerdata[5]*markerdata[3]*10)/10; //MarkOffsetU
		Markertypes[q][10] = Math.ceil(markerdata[5]*markerdata[4]*10)/10; //MarkOffsetV
		Markertypes[q][11] = Math.floor(Column.GetWriteField()/2 - Math.abs(markerdata[6] / 2) - Math.abs(Markertypes[q][9])); //MarkplaceU
		Markertypes[q][12] = Math.floor(Column.GetWriteField()/2 - Math.abs(markerdata[6] / 2) - Math.abs(Markertypes[q][10]));	//MarkplaceV
		Markertypes[q][13] = Math.ceil((markerdata[2]*1 - markerdata[9]*markerdata[2])*1000);//Profile min
		Markertypes[q][14] = Math.ceil((markerdata[2]*1 + markerdata[9]*markerdata[2])*1000);//Profile max
		Markertypes[q][15] = markerdata[10]; //ContrastLow
		Markertypes[q][16] = markerdata[11]; //ContrastHigh
		Markertypes[q][17] = "Mode:0,L1:" + Markertypes[q][15] + ",L2:" + Markertypes[q][16] + ",Profile:" + markerdata[12] + ",Min:" + Markertypes[q][13] + ",Max:" + Markertypes[q][14] + ",LFL:0,RFL:1,LNo:1,RNo:1,LeftE:0.5,RightE:0.5,DIS:0,ZL:0,ZR:0";//threshold
		Markertypes[q][18] = "0,0.000000,0.000000,0.000000,0.000000,0.000000," + Markertypes[q][1] + "," + Markertypes[q][2] + ",0.000000,LN,UV,Multisample WF align,STAY;,ALWF_AUTOLINE," + markerdata[6] + "," + markerdata[7] + "," + Markertypes[q][5] + "," + Markertypes[q][6] + ",U,16,,,,,,,,,,,,,,,,,,,,,,,0.0,15,0,1,";

		Markertypes[q][1] = Markertypes[q][1].toString();
		Markertypes[q][2] = Markertypes[q][2].toString();
		Markertypes[q][3] = (Math.abs(Markertypes[q][3])).toString();
		Markertypes[q][4] = (Math.abs(Markertypes[q][4])).toString();
		Markertypes[q][5] = Markertypes[q][5].toString();
		Markertypes[q][6] = Markertypes[q][6].toString();
		Markertypes[q][7] = Markertypes[q][7].toString();
		Markertypes[q][8] = Markertypes[q][8].toString();
		Markertypes[q][9] = Markertypes[q][9].toString();
		Markertypes[q][10] = Markertypes[q][10].toString();
		Markertypes[q][11] = Markertypes[q][11].toString();
		Markertypes[q][12] = Markertypes[q][12].toString();
		Markertypes[q][13] = Markertypes[q][13].toString();
		Markertypes[q][14] = Markertypes[q][14].toString();
		Markertypes[q][15] = Markertypes[q][15].toString();
		Markertypes[q][16] = Markertypes[q][16].toString();
		Markertypes[q][17] = Markertypes[q][17].toString();
		Markertypes[q][18] = Markertypes[q][18].toString();
		
	}
	return Markertypes;
}

function LoadWFAlignProcedures() 
{
	var loadlist, Alignprocedures, q, p, entries;
	loadlist = GAlignprocedures.ReadString("LoadList", "load", "0").split(";");
	Alignprocedures = createArray(loadlist.length,20);

	for (q = 0; q < loadlist.length; q ++) 
	{
		entries = GAlignprocedures.ReadSection(loadlist[q]).split(",");
		if (entries[entries.length-2] != "log" || entries[entries.length-1] != "alwayswrite")
		{
    		App.ErrMsg(0,0,"Align procedure '" + loadlist[q] + "' not configured properly. Add 'log' and 'alwayswrite' switch to Alignprocedures.txt and restart script.");
    		Abort();			
		}
		Alignprocedures[q][0] = loadlist[q];
		Alignprocedures[q][1] = entries.length;
		for (p = 0; p < entries.length; p ++) 
		{
			Alignprocedures[q][p+2] = GAlignprocedures.ReadString(loadlist[q], entries[p], "undefined");
			if (Alignprocedures[q][p+2] == "undefined") 
			{
    			App.ErrMsg(0,0,"Align procedure '" + loadlist[q] + "' not configured properly. Check Alignprocedures.txt and restart script.");
    			Abort();
			}
		}
	}
	return Alignprocedures;
}

function AutoWFAlign(markertype) //Aligns WF according to markertype, called from AlignWF
{
	var Markertypes, n, m, parlistname, parlist, multiini, multipls, PList, q, fmarkers;
	Markertypes = LoadMarkers();
	for (n = 0; n < Markertypes.length; n++)
	{
		if (Markertypes[n][0] == markertype) 
		{
			m = n;
			break;
		}
	}
  	
    parlistname = new Array("SizeU","SizeV","StepU","StepV","PointsU","PointsV","MarkOffsetU","MarkOffsetV","MarkPlaceU","MarkPlaceV");
	//parlist = new Array(SizeU,SizeV,StepU,StepV,PointsU,PointsV,MarkOffsetU,MarkOffsetV,MarkPlaceU,MarkPlaceV);
	parlist = new Array(Markertypes[m][3],Markertypes[m][4],Markertypes[m][5],Markertypes[m][6],Markertypes[m][7],Markertypes[m][8],Markertypes[m][9],Markertypes[m][10],Markertypes[m][11],Markertypes[m][12]);
	multiini = App.OpenIniFile(Glib + "Multisample WF align.ini");
	for (q = 0; q < parlist.length; q ++)  //Loop writes markerproperties to Multisample WF align.ini
	{	
		multiini.WriteString("Multisample WF align", parlistname[q], parlist[q]);
	}
	
	multipls = App.OpenIniFile(Glib + "Multisample WF align.pls");
	multipls.DeleteSection("DATA");
	multipls.WriteString("DATA", Markertypes[m][18], 0);

	InstallWFAlign(Markertypes[m][17]);
	PList = OpenPositionList(Glib + "Multisample WF align.pls");
	App.Exec("ScanAllPositions()");
	PList.Save();
	PList.Close();
	fmarkers = App.GetVariable("AlignWriteField.AutoMarksFailed");
	return(fmarkers);
}

function AlignWF(markprocedure, logWFflag, i, j, k) //Main function to start automatic WF alignment
{
	if (markprocedure != -1)
	{
		var WFAlignprocedures, m, n, a, b, c, d, entries, markers, amf, logfile, logstring;
		WFAlignprocedures = LoadWFAlignProcedures();
		m = j + 1;
		n = k + 1;

		for (a = 0; a < WFAlignprocedures.length; a++) //Loop for selecting procedure using index 'b'.
		{
		
			if (WFAlignprocedures[a][0] == markprocedure) 
			{
				b = a;
				break;
			}
		}
		entries = WFAlignprocedures[b][1];
		//App.ErrMsg(0,0,WFAlignprocedures[b][entries+1])
		for (c = 0; c < entries-2; c++)
		{
			markers = WFAlignprocedures[b][c+2].split(";");
			logstring = " ";

			for (d = 0; d < markers.length; d++)
			{
				amf = AutoWFAlign(markers[d]);
				logstring = logstring + markers[d] + " = " + amf + ", ";
				Panicbutton();
				if (amf == 0) break;
			}

			if (WFAlignprocedures[b][entries+1] == 1 && logWFflag == 1)
			{
				logfile = App.OpenInifile(Glogfilename[1] + Glogfilename[2]);
				logfile.WriteString("Failed markers S" + i,"Markprocedure", markprocedure);
				logfile.WriteString("Failed markers S" + i,"Device nx/ny[" + m + ";" + n + "] - Step " + Math.round(c+1) + ": ", logstring);
			}
		}
		if (WFAlignprocedures[b][entries+2] == 0 && amf >= 1) exposure = 0; //checks 'alwayswrite' and failed markers of last alignment and sets 'exopsure' accordingly
		else exposure = 1;
	}
	return exposure;	
}


function ActivateColdata(colset)
{
	var multipls, PList, lastcolset;
	lastcolset = LastDatasettoColset();
	if (lastcolset != colset)
	{
		multipls = App.OpenIniFile(Glib + "ActivateColumnDataset.pls");
		multipls.DeleteSection("DATA");
		multipls.WriteString("DATA", "0,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,VN,UV,set ViCol mode entry,STAY,VICOL,,,,,,,,,,," + colset + ",106,,,,,,,,,,,,,,,,", 0);
		PList = OpenPositionList(Glib + "ActivateColumnDataset.pls");
		App.Exec("ScanAllPositions()");
		PList.Save();
		PList.Close();	
	}
}

function SetSvars(i, WFflag, msflag) //msflag?
{
	var ZoomX, ZoomY, ShiftX, ShiftY, RotX, RotY, corrZoomX, corrZoomY, corrShiftX, corrShiftY, corrRotX, corrRotY;

	if (parseFloat(S[1][5][i]) != parseFloat(Column.GetWriteField()))
	{
		Column.SetWriteField(S[1][5][i], true);	
	}
	ActivateColdata(S[2][5][i]);
	App.Exec("OpenDatabase(" + S[3][5][i] + ")");
	App.Exec("ViewStructure(" + S[4][5][i] + ")");
	if (WFflag == 1)
	{
		App.Exec("GetCorrection()");
		ZoomX = App.GetVariable("Variables.ZoomX");
		ZoomY = App.GetVariable("Variables.ZoomY");
		ShiftX = App.GetVariable("Variables.ShiftX");
		ShiftY = App.GetVariable("Variables.ShiftY");
		RotX = App.GetVariable("Variables.RotX");
		RotY = App.GetVariable("Variables.RotY");

		corrZoomX = S[5][5][i] / ZoomX;
		corrZoomY = S[6][5][i] / ZoomY;
		corrShiftX = S[7][5][i] - ShiftX;
		corrShiftY = S[8][5][i] - ShiftY;
		corrRotX = S[9][5][i] - RotX;
		corrRotY = S[10][5][i] - RotY;

		App.Exec("SetCorrection(" + corrZoomX + ", " + corrZoomY + ", " + corrShiftX + ", " + corrShiftY + ", " + corrRotX + ", " + corrRotY + ")");	
	}
	if (msflag == 0)
	{
		StepsizeDwelltime(i,0,0); //GUIflag only 0 in setsvars function. Needed for exposureloops icw MS defined stepsizes.
		SetStepsizeDwelltime(i);	//bcflag should be one, beamcurrent should be set
	}
	
}

function WriteMatrix(S, i)
{
	var N, k, j;

	N = createArray(S[2][4][i]+1,S[3][4][i]+1,2);
	for (k = 0; k <= S[3][4][i]-1; k++)
	{
		for (j = 0; j <= S[2][4][i]-1; j++)
		{
		N[j+1][k+1][1] = parseFloat((j * S[4][4][i]) + S[6][4][i]);
		N[j+1][k+1][2] = parseFloat((k * S[5][4][i]) + S[7][4][i]);
		}
	}
	return(N);	
}

function Write(S, i, testmode) //S-matrix, n-th chip, type of writing (single,multiple..etc), testmode ornot
{
	var N, meander, k, j, mj, l61, l61exp, exposure;
	
	N = WriteMatrix(S, i);
	meander = 1;
	for (k = 0; k <= S[3][4][i]-1; k++)
	{
		for (j = 0; j <= S[2][4][i]-1; j++)
		{	
			if (isEven(k) == 0 && meander == 1)
			{
				mj = (S[2][4][i]-1)-j;
			}
			else
			{
				mj = j;
			}
			
			Panicbutton();
			Stage.GlobalAlignment();
			Stage.DriveUV(N[mj+1][k+1][1], N[mj+1][k+1][2]);
			Stage.LocalAlignment();
			OriginCorrection();
			if (S[12][4][i] != -1) //Checks if layer 61 is enabled
			{
				l61 = S[12][4][i].split("-");

				if (S[13][4][i] == 1)
				{
					AlignWF(S[10][4][i], 1, i, j, k);
				}	
				if (S[13][4][i] == 2 && k == 0 && j == 0)
				{	
					AlignWF(S[10][4][i], 1, i, j, k);
				}	
				
				InstallGDSmarker(l61[0], k, mj);
				App.Exec("UnSelectAllExposedLayer()");                      //Deselects al exposed layers
				
				if (testmode == 1) 
				{
					App.Exec("SelectExposedLayer(61)"); 
				}
				else 
				{
					
					l61exp = 61 + ";" + l61[1]; 
					App.Exec("SelectExposedLayer(" + l61exp + ")");			
				}
				App.Exec("Exposure");
			}
			if (S[1][4][i] != -1) //Checks if a global layer is selected
			{
				if (S[13][4][i] == 1)
				{
					exposure = AlignWF(S[10][4][i], 1, i, j, k); //align a writefield or not depending on S[10][4][i]
				}	
				if (S[13][4][i] == 2 && k == 0 && j == 0)
				{	
					exposure = AlignWF(S[10][4][i], 1, i, j, k); //align a writefield or not depending on S[10][4][i]
				}
				if (S[13][4][i] == 3 || S[13][4][i] == 4) exposure = 1;							
				App.Exec("UnSelectAllExposedLayer()");                      //Deselects al exposed layers
				App.Exec("SelectExposedLayer(" + S[1][4][i] + ")");
				if (testmode != 1 && exposure == 1) App.Exec("Exposure");
			}
		RemoveGDSlogflag();		
		}
	}
	Stage.GlobalAlignment();
}

function FirstWFAlign()
{
    var wfprocedureloadlist, markprocedure;
    wfprocedureloadlist = GAlignprocedures.ReadString("LoadList", "load", "0").split(";");
    markprocedure = App.InputMsg("Select AutoWFAlign scan procedure", "Select: " + wfprocedureloadlist, wfprocedureloadlist[0]);
	AlignWF(markprocedure, 0, 1, 1, 1);
}

function Start()
{
	var GUIflag, beamoffflag, testmode;

	Stage.GlobalAlignment();
    
	if (App.Errmsg(EC_YESNO, 0 , "Do WF alignment only?") == EA_YES)
	{
	   FirstWFAlign();
	   Abort();
	}

	var as = App.InputMsg("Select sample data source","Select '1' to collect sample data or select '2' to read 'Multisample.txt'.", "1");
	if (as!=1 && as!=2) Abort();  
	
	if (as == 1)
	{
		st = App.InputMsg("Select procedure","1: Single-settings Mode, 2: Per-sample-settings mode, 3: Load from SDvars.txt", "1");
		if (st!=1 && st!=2 && st!=3) Abort();  
		if (st == 1 || st == 2)	
		{
			GUIflag = App.InputMsg("Select data aquiring procedure","1: Easy automatic collection during UV alignment, 2: Manual collection using GUI","1");
			S = CollectSD(st, GUIflag);
		}
		else
		{
			Gnums = Detectnums(GSDini, "SDvars.txt", 1);
			Load(1);
		}

	}	
	else
	{
		Gnums = Detectnums(Gsampleini, "Multisample.txt", 1);
		Load(0);
	}
	Glogfilename = Logdata();
	beamoffflag = 0;

	if (App.Errmsg(EC_YESNO, 0 , "Run in test mode? (No exposure)") == EA_YES)
	{
		testmode = 1;
		//if (App.Errmsg(EC_YESNO, 0 , "Overwrite Multisample.txt with logfile for easy loading of paramters?") == EA_YES)
		//{
		//	App.ErrMsg(0,0,"Function not yet implemented")
		//}
	}
	else
	{
		if (App.Errmsg(EC_YESNO, 0 , "Turn off EHT after writing?") == EA_YES) beamoffflag = 1;
		testmode = 0;
	}
	
	
	if (App.ErrMsg(EC_YESNO,0,"Writing now commences.") == EA_NO)
	{
		Abort();
	}
	for (i = 1; i<= Gnums; i++)
	{
		Panicbutton();
		AlignUV(i);
		SetSvars(i, 1, 0);
		
		Write(S, i, testmode);
    }
    if (beamoffflag == 1)                                                //5 lines: Turn off beam if option has been set.
    {
		Column.HTOnOff = false;
		App.ProtocolEvent(30, 0, 0, "Beam shutdown.");
    }
}

Install(0);
ResetPanicbutton();
Start();
Succes(beamoffflag);