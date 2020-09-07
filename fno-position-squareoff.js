"use strict";
var KiteConnect = require("kiteconnect").KiteConnect;
//var KiteTicker = require("kiteconnect").KiteTicker;
var SimpleNodeLogger = require('simple-node-logger');
const fs = require('fs');
var dateFormat = require('dateformat');
var abs = require( 'math-abs' );
var  moment = require("moment-timezone");
var now = moment();

//console.log('Before load config');

var config_items = require('./load_config.js');

//console.log('after load config.. argyment '+ process.argv[2]);

const cfg_static =  new config_items(process.argv[2]);

//console.log('after creating cfg_static -- '+ JSON.stringify(cfg_static));
//console.log('zone file -'+cfg_static['zone_file_path']);

const cfg_trades= new config_items(cfg_static['zone_file_path']);

var err_count={},orders_placed=0, alerts_sent=false;

//console.log('after creating cfg_trades');


//const accountSid = 'ACd9e70d2f8cb3bc946caef5b4acde9117';
//const authToken = '064f1fd797bb147b91887557eedceede';
const client = require('twilio')(cfg_static['twilio_sid'], cfg_static['twilio_token']);
//const client =require('twilio')(process.env.TWILIO_ACCOUNT_SID,process.env.TWILIO_AUTH_TOKEN);

var max_positions, running=true;


var options = {
	"api_key": cfg_static['api_key'],
	"debug":false 
};



let date_string = dateFormat(new Date(), "yyyymmddhh")+"-squareoff-"+ process.argv[2]+".log";
console.log('log file path - ',date_string);


var log_opts = {
		logFilePath:'logs/'+date_string,
        timestampFormat:'YYYY-MM-DD HH:mm:ss.SSS'
    };
	

var log = SimpleNodeLogger.createSimpleLogger( log_opts );
var current_risk=0;

var instruments=[], items=[], risk_buffer=0;

var kc = new KiteConnect(options);
kc.setAccessToken(cfg_static['access_token']);
kc.setSessionExpiryHook(sessionHook);

//var result = square_off_tgt_sl();

//log.info('Positions - ' , result);


square_off_tgt_sl().then
(
		function(resp) 
		{
			log.info('Back to main loop after main logic with no uncaught exceptions- ',resp);
		}
		
		//await square_off_tgt_sl();
		
).catch(
	function(err) 
	{
		log.error('uncaught error in main logic ',err);
		client.messages
				  .create({
					 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
					 body: 'In Position Square off -' + JSON.stringify(err),
					 to: 'whatsapp:'+ cfg_static['twilio_subscribed_num']
				   });
	}
); 





function sessionHook() {
	log.info("User loggedout");
}



async function time_check(timezone, start_time, end_time)
{
			let str = (moment.tz(now, timezone).format()).split("T");
			let timecomponent=str[1].split(":");
			let timevalue=(parseInt(timecomponent[0])*60)+ parseInt(timecomponent[1]);
			//log.info('Time value -' ,timevalue, ' Start Time -', start_time, ' End time -', end_time);
			//let running=true;
			
			if(timevalue<start_time || timevalue >end_time) 
			{
				return false;
			}
			
			return true;
	
}



async function square_off_tgt_sl()
{
		var positions,holdings; 
		var results;
		
		
		
		var trade, sl_hit=0, tgt_hit=0, tl_sl_hit=0, sl_readjust=0,arr=[],mult_factor=1, trans_type,process_entry=0;
		
		var run;
		
		
		
		if(!await time_check("Asia/Calcutta",cfg_static['start_time'],cfg_static['end_time']))
		{
				log.info('Outside market hours -',cfg_static['start_time'],' - ', cfg_static['end_time']);
				return arr;
		}
		
		
		
		for (let x=0; x<cfg_trades.length; x++)
		{
			err_count[cfg_trades[x]['TRADE_INSTRUMENT']]=false;
		}
		
		//log.info('Initialized err count -' , JSON.stringify(err_count));
		
		while(true)
		{
		  
			 await sleep(cfg_static['sleep_window']); 
			 try
			  {
	
						
						if(orders_placed>cfg_static['max_orders_per_run'])
						{
								throw('More than ',cfg_static['max_orders_per_run'],' orders have already been placed so idling away');
								
								
						}
						
						
						positions={};
                        holdings={};
                  
                        holdings= await kc.getHoldings();      
                  
                       // log.info('Scanning through holdings-', JSON.stringify(holdings));
                  
                        
                  
						positions = await kc.getPositions();
                  
						results=[].concat(holdings,positions['net']);
                        
                        //results.concat(holdings);
                        
						current_risk=0;
						max_positions=0;
						
						let arr_orders = await kc.getOrders();
				
						if(arr_orders.length>cfg_static['max_orders_per_day'])
						{
								throw('Max orders exceeded for the day');
								//return arr;
						}
                  
                        //log.info('First looping through Holdings -', JSON.stringify(holdings));
            
				
						log.info('Looping through -', JSON.stringify(results));
                  
                        process_entry=0;
				
						for (let index =0; index <results.length; index++)
						{

										log.info('Processing -', JSON.stringify(results[index]['tradingsymbol']));
											
											
										if(err_count[results[index]['tradingsymbol']])
										{
												log.error(results[index]['tradingsymbol'] ,' already had some errors before so skipping');
										}
										else
										{
											if(results[index]['product']==cfg_static['cash_product'])
                                            {
                                               if(results[index]['quantity']>0) 
                                                {
                                                    process_entry=1;
                                                }
                                            }
                                            else
                                            {
                                            
                                                if(results[index]['quantity']!=0)
                                                {
                                                    process_entry=1;
                                                }
                                            
                                            }
                                            
                                            if(process_entry)
											{
													//log.info('Searching for trading instrument in json config -',JSON.stringify(cfg_trades));
												
													let sqoff_order_resp={}, option_limit_order_exists=false, fut_limit_order_exists=false;
													
													trade = cfg_trades.find(trade => (trade['TRADE_INSTRUMENT'] == results[index]['tradingsymbol']));
													
													if(trade == undefined)
													{
															log.error ('Catastrophe -- position not found in file for ', results[index]['tradingsymbol']);
															
															err_count[results[index]['tradingsymbol']]= true;
															
															throw('Stop loss config missing for -' + results[index]['tradingsymbol']);
														
													}
													else
													{
													
															
													       
															
                                                           trans_type="";
                                                           log.info('Trade config -', JSON.stringify(trade));
                                                        
                                                           log.info('Entry - ', trade['ENTRY'],' Target - ', trade['TARGET'], ' SL - ',trade['STOP_LOSS']);
                                                        
                                                            trans_type=(parseFloat(trade['ENTRY'])>parseFloat(trade['TARGET']))?"SELL":"BUY";
                                                        
                                                            /**if(trade['ENTRY']>trade['TARGET'])
                                                                {
                                                                    trans_type="SELL";
                                                                    log.info('Setting to SELL');
                                                                }
                                                                else
                                                                {
                                                                    trans_type="BUY";        
                                                                    log.info('Setting to BUY');
                                                                }**/
															
															mult_factor=(trade['TRADE_INSTRUMENT_TYPE']== 'OPTION'?cfg_static['mult_factor']:1);
															
															//current_risk+= Math.round(abs((trade['STOP_LOSS']-trade['ENTRY'])*results[index]['quantity']*mult_factor));
															
															let x ='NSE'+":"+trade['SYMBOL'];
															let resp_ohlc= await kc.getOHLC(x);
                                                        
                                                          //  log.info('Resp OHLC -',JSON.stringify(resp_ohlc));
													         	
                                                             sl_hit=0;
                                                             tgt_hit=0;
														
															if(trans_type=="SELL")
															{
																	log.info('IN SELL');
																	if(parseFloat(trade['STOP_LOSS'])< parseFloat(resp_ohlc[x]['last_price']))
																	{
																		sl_hit=1;
																	}
																	else if(parseFloat(resp_ohlc[x]['last_price'])<=parseFloat(trade['TARGET'])) 
																	{
																		tgt_hit=1; 
																	
																	}
                                                                   /** else if(parseFloat(resp_ohlc[x]['ohlc']['low'])<=((1-cfg_static['trailing_sl'])*parseFloat(trade['ENTRY'])))
                                                                    {
                                                                        if(parseFloat(resp_ohlc[x]['last_price'])>=parseFloat(trade['ENTRY']))
                                                                            {
                                                                                tl_sl_hit=1;
                                                                                log.info('TL SL hit for ',x);
                                                                            }
                                                                        
                                                                            
                                                                     }**/
																	
															}
															else
															{
                                                               // log.info('Trans type - ',trans_type);
                                                               // log.info('Trade config -', JSON.stringify(trade));    
                                                                
                                                                log.info('IN BUY');
																if(parseFloat(trade['STOP_LOSS'])> parseFloat(resp_ohlc[x]['last_price']))
																{
																	sl_hit=1;
																}
																else if(parseFloat(resp_ohlc[x]['last_price'])>=parseFloat(trade['TARGET'])) 
																{
																	tgt_hit=1; 
																
																}
                                                               /** else if(parseFloat(resp_ohlc[x]['ohlc']['high'])>=((1+cfg_static['trailing_sl'])*parseFloat(trade['ENTRY'])))
                                                                {
                                                                    if(parseFloat(resp_ohlc[x]['last_price'])<=parseFloat(trade['ENTRY']))
                                                                    {
                                                                        tl_sl_hit=1;
                                                                        log.info('TL SL hit for ',x);
                                                                    }


                                                                 } **/
															}
													
													
															if(sl_hit || tgt_hit) 
															{
																
																	log.info('LTP hash ',JSON.stringify(resp_ohlc),'Low ',resp_ohlc[x]['ohlc']['low'],' High ',resp_ohlc[x]['ohlc']['high']);
																	//log.info('Position stop loss config - ', JSON.stringify(trade));
																	//log.info('SL hit , TGT hit -',sl_hit,' - ', tgt_hit);

																	if(trade['TRADE_INSTRUMENT_TYPE'] == 'OPTION')
																	{
																								
																			let liquidity=0, limit_price=0;
																			
																			let top_key=trade['EXCHANGE']+":"+trade['TRADE_INSTRUMENT'];
																			
																			
																			/** check order history for the day**/
																			for (let i=0; i< arr_orders.length; i++)
																			{
																				   if((arr_orders[i]['tradingsymbol']==trade['TRADE_INSTRUMENT'])&& 
																					   (arr_orders[i]['transaction_type']=="SELL"))
																					{
																						
																							option_limit_order_exists=true;
																							log.error('square off order already exists for ', top_key);
																							
																							err_count[trade['TRADE_INSTRUMENT']]= true;
																						
																							await client.messages
																							  .create({
																								 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
																								 body: 'Square off order already exists for ', top_key,
																								 to: 'whatsapp:'+ cfg_static['twilio_subscribed_num']
																							   });
																						 
																					 
																					}
																			 }
																				
																					
																			if(!option_limit_order_exists)
																			{
																			
																				let mkt_depth = await kc.getQuote(top_key);
																				
																				log.info('Market Depth for '+ trade['TRADE_INSTRUMENT']+' is '+ JSON.stringify(mkt_depth));
																													
																				liquidity=mkt_depth[top_key]['depth']['buy'][0]['quantity'];
																				
																				if(liquidity<=0) 
																				{
																						limit_price=mkt_depth[top_key]['last_price'];
																						//throw('No liquidity for '+instruments[j]['TRADE_INSTRUMENT']);
																				}
																				else
																				{
																						limit_price = mkt_depth[top_key]['depth']['buy'][0]['price'];
																				}
																						
																				if(limit_price<=0)
																				{
																						log.error('In Square off : Error in getting limit price for ',trade['TRADE_INSTRUMENT']);
																						
																						err_count[trade['TRADE_INSTRUMENT']]= true;
																						await client.messages
																							  .create({
																								 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
																								 body: 'In Square off : Error in getting limit price for '+trade['TRADE_INSTRUMENT'],
																								 to: 'whatsapp:'+ cfg_static['twilio_subscribed_num']
																							   });
																							  
																				}
																				else
																				{
																				
																						log.info('placing order with trade instrument - ', trade['EXCHANGE']+":"+trade['TRADE_INSTRUMENT'], ' - product - ',cfg_static['fno_product'],' limit - ', limit_price, '-type of order - ',cfg_static['order_type'] );
																						
																						sqoff_order_resp = await kc.placeOrder(cfg_static['order_type'], {
																									"exchange": trade['EXCHANGE'],
																									"tradingsymbol": trade['TRADE_INSTRUMENT'],
																									"transaction_type": "SELL", // always SELL the option as square off
																									"quantity": results[index]['quantity'],
																									"product": cfg_static['fno_product'],
																									"order_type": "LIMIT",
																									"price":limit_price
																								});
																								
																						 orders_placed++;
																				 }
																		}						
																							
																	}
																	else
																	{
																			let sqoff_type=(parseFloat(trade['ENTRY'])>parseFloat(trade['TARGET']))?"BUY":"SELL";
																			
                                                                            let top_key=trade['EXCHANGE']+":"+trade['TRADE_INSTRUMENT'];
																		 
																			for (let i=0; i< arr_orders.length; i++)
																			{
																				   if((arr_orders[i]['tradingsymbol']==trade['TRADE_INSTRUMENT'])&& 
																					   (arr_orders[i]['transaction_type']==sqoff_type))
																   
																					{
																						
																							fut_limit_order_exists=true;
																							log.error('square off order already exists for ', top_key);
																							err_count[trade['TRADE_INSTRUMENT']]= true;
																							
																							await client.messages
																						    .create({
																							 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
																							 body: 'Square off order already exists for ', top_key,
																							 to: 'whatsapp:'+ cfg_static['twilio_subscribed_num']
																						   });
																					 
																					 
																					}
																			 }
																		 
																		 
																		 
																			if(!fut_limit_order_exists)
																			{
																					 // reverse logic of place order
																					 let product_type=(trade['TRADE_INSTRUMENT_TYPE']=="CASH")?cfg_static['cash_product']:cfg_static['fno_product'];
																					 
																					 
																					 log.info('Before calling place order for -',trade['SYMBOL'],' with product ',product_type );
																					//let pc=new Order_place(params);
																					 sqoff_order_resp = await kc.placeOrder(cfg_static['order_type'], 			{
																									"exchange": trade['EXCHANGE'],
																									"tradingsymbol": trade['TRADE_INSTRUMENT'],
																									"transaction_type":sqoff_type,
																									"quantity": abs(results[index]['quantity']),
																									"product": product_type,
																									"order_type": "MARKET"
																								 });
																					
																					orders_placed++;
																			 }
																		 
																	 }
																
															
																		if (sqoff_order_resp.order_id == undefined)
																		{
																				if(!option_limit_order_exists && !fut_limit_order_exists)
																				{
																						log.error('Couldnt place square off order for ',trade['SYMBOL']);
																						
																						err_count[trade['TRADE_INSTRUMENT']]= true;
																						
																						await client.messages
																						  .create({
																							 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
																							 body: 'Couldnt place order for '+trade['SYMBOL'],
																							 to: 'whatsapp:'+ cfg_static['twilio_subscribed_num']
																						   });
																						  
																				}
																		 }
																		 else
																		 {
																			
																			arr.push(trade['TRADE_INSTRUMENT']);
																			await client.messages
																			  .create({
																				 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
																				 body: 'Squareoff order id  '+sqoff_order_resp.order_id,
																				 to: 'whatsapp:'+ cfg_static['twilio_subscribed_num']
																			   });
																			  
																			
																			
																		 }
															
															}
															else
															{
																max_positions++;
															}
													 }
											
											}
											else
											{
												
												current_risk+=-1*(parseFloat(results[index]['pnl']));
												//log.info('Updating risk from PNL - ', current_risk);
												
											}
									    }
						
								}

				

			   }
			   catch(err)
			   {
					log.error('uncaught error in main logic ',err);
					if(!alerts_sent)
					{
						await client.messages
							  .create({
								 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
								 body:'In Square off '+JSON.stringify(err),
								 to: 'whatsapp:'+ cfg_static['twilio_subscribed_num']
							   });
							   
						alerts_sent=true;
					}
			   }
		 }

		
		return arr;
}


function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

